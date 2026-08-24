import { randomUUID } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { AppConfig } from '../config.js';
import { parsePathList } from '../platform-paths.js';
import { sha256File, verifySha256 } from './checksum.js';
import { downloadToFile } from './download.js';
import { WarehouseMetadataStore } from './metadata-store.js';
import {
  inferFileExtension,
  isPathInside,
  partitionSegment,
  resolveAllowedImportPath,
  sqlString,
  validatePartitionValue,
} from './path-utils.js';
import type {
  CandleQuery,
  CandleSelection,
  ImportCompletion,
  ImportedParquetFile,
  WarehouseFileFilter,
  WarehouseImportFileRequest,
  WarehouseImportRequest,
  WarehouseImportUrlRequest,
} from './types.js';

type PreparedImport = WarehouseImportRequest & {
  checksumSha256: string;
};

const BINANCE_KLINE_COLUMNS = `{
  'open_time': 'BIGINT',
  'open': 'DOUBLE',
  'high': 'DOUBLE',
  'low': 'DOUBLE',
  'close': 'DOUBLE',
  'volume': 'DOUBLE',
  'close_time': 'BIGINT',
  'quote_asset_volume': 'DOUBLE',
  'trade_count': 'BIGINT',
  'taker_buy_base_asset_volume': 'DOUBLE',
  'taker_buy_quote_asset_volume': 'DOUBLE',
  'ignore': 'VARCHAR'
}`;

/**
 * Owns the warehouse write queue. DuckDB can parallelize a query internally,
 * while imports remain serialized to avoid multiple writers in this MCP process.
 */
export class WarehouseService {
  private readonly parquetRoot: string;
  private readonly tempRoot: string;
  private readonly importRoots: string[];
  private readonly metadata: WarehouseMetadataStore;
  private readonly instance: Promise<DuckDBInstance>;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly config: AppConfig) {
    this.parquetRoot = resolve(config.WAREHOUSE_PARQUET_ROOT);
    this.tempRoot = resolve(config.WAREHOUSE_TEMP_DIR);
    this.importRoots = parsePathList(config.WAREHOUSE_IMPORT_ROOTS);
    mkdirSync(this.parquetRoot, { recursive: true });
    mkdirSync(this.tempRoot, { recursive: true });
    for (const root of this.importRoots) mkdirSync(root, { recursive: true });
    this.metadata = new WarehouseMetadataStore(config.WAREHOUSE_METADATA_DB_PATH);
    this.instance = DuckDBInstance.create(':memory:');
  }

  public importFile(request: WarehouseImportFileRequest): Promise<ImportCompletion> {
    return this.enqueueImport(async () => {
      const path = resolveAllowedImportPath(request.path, this.importRoots);
      return this.importManagedFile(path, request, path);
    });
  }

  public importUrl(request: WarehouseImportUrlRequest): Promise<ImportCompletion> {
    return this.enqueueImport(async () => {
      const taskDirectory = mkdtempSync(join(this.tempRoot, 'download-'));
      try {
        const url = new URL(request.url);
        const extension = inferFileExtension(url.pathname);
        if (!['.csv', '.zip', '.parquet'].includes(extension)) {
          throw new Error('Import URL must end in .csv, .zip or .parquet.');
        }
        const path = join(taskDirectory, `download${extension}`);
        await downloadToFile(
          request.url,
          path,
          this.config.WAREHOUSE_MAX_IMPORT_BYTES,
          this.config.WAREHOUSE_DOWNLOAD_TIMEOUT_MS,
        );
        const auditUrl = new URL(request.url);
        auditUrl.search = '';
        auditUrl.hash = '';
        return await this.importManagedFile(path, request, auditUrl.toString());
      } finally {
        this.removeTemporaryDirectory(taskDirectory);
      }
    });
  }

  public status(): Record<string, unknown> {
    return {
      enabled: true,
      dataDirectory: this.config.BINANCE_RESEARCH_DATA_DIR,
      parquetRoot: this.parquetRoot,
      metadataDatabasePath: resolve(this.config.WAREHOUSE_METADATA_DB_PATH),
      importRoots: this.importRoots,
      maxImportBytes: this.config.WAREHOUSE_MAX_IMPORT_BYTES,
      ...this.metadata.status(),
    };
  }

  public listDatasets(): unknown[] {
    return this.metadata.listDatasets();
  }

  public listFiles(filter: WarehouseFileFilter): unknown[] {
    return this.metadata.listFiles(filter);
  }

  public async queryCandles(query: CandleQuery): Promise<unknown[]> {
    const selection = this.prepareCandleSelection(query);
    const files = this.existingCandleFiles(selection);
    if (files.length === 0) return [];
    const conditions: string[] = [];
    const values: Record<string, string> = {};
    if (query.startTime !== undefined) {
      conditions.push("open_time >= timezone('UTC', CAST($startTime AS TIMESTAMPTZ))");
      values['startTime'] = query.startTime;
    }
    if (query.endTime !== undefined) {
      conditions.push("open_time <= timezone('UTC', CAST($endTime AS TIMESTAMPTZ))");
      values['endTime'] = query.endTime;
    }
    const fileList = files.map(sqlString).join(', ');
    const sql = `
      SELECT open_time, open, high, low, close, volume, close_time,
             quote_asset_volume, trade_count, taker_buy_base_asset_volume,
             taker_buy_quote_asset_volume, dataset, source, market, symbol, interval
      FROM read_parquet([${fileList}], union_by_name = true)
      ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
      QUALIFY row_number() OVER (PARTITION BY open_time ORDER BY imported_at DESC) = 1
      ORDER BY open_time DESC
      LIMIT ${query.limit}`;
    return this.readRows(sql, values);
  }

  public async candleDataRange(selection: CandleSelection): Promise<Record<string, unknown>> {
    const prepared = this.prepareCandleSelection(selection);
    const files = this.existingCandleFiles(prepared);
    if (files.length === 0) {
      return { ...prepared, rowCount: 0, minOpenTime: null, maxOpenTime: null };
    }
    const fileList = files.map(sqlString).join(', ');
    const rows = await this.readRows(`
      WITH deduplicated AS (
        SELECT open_time
        FROM read_parquet([${fileList}], union_by_name = true)
        QUALIFY row_number() OVER (PARTITION BY open_time ORDER BY imported_at DESC) = 1
      )
      SELECT COUNT(*) AS row_count, MIN(open_time) AS min_open_time,
             MAX(open_time) AS max_open_time
      FROM deduplicated`);
    const row = rows[0];
    return {
      ...prepared,
      rowCount: Number(row?.['row_count'] ?? 0),
      minOpenTime: this.optionalText(row?.['min_open_time']) ?? null,
      maxOpenTime: this.optionalText(row?.['max_open_time']) ?? null,
    };
  }

  public async close(): Promise<void> {
    this.metadata.close();
    (await this.instance).closeSync();
  }

  private async importManagedFile(
    inputPath: string,
    request: WarehouseImportRequest,
    sourceUri: string,
  ): Promise<ImportCompletion> {
    const inputStat = statSync(inputPath);
    if (!inputStat.isFile()) throw new Error('Warehouse imports must reference a file.');
    if (inputStat.size > this.config.WAREHOUSE_MAX_IMPORT_BYTES) {
      throw new Error(
        `Import is larger than WAREHOUSE_MAX_IMPORT_BYTES (${this.config.WAREHOUSE_MAX_IMPORT_BYTES}).`,
      );
    }

    const prepared = await this.prepareImport(request, inputPath);
    const duplicate = this.metadata.findCompleted(prepared);
    if (duplicate !== undefined && duplicate.files.every((file) => existsSync(file.path))) {
      return duplicate;
    }

    const importId = randomUUID();
    const outputDirectory = this.outputDirectory(importId, prepared);
    this.metadata.startImport(importId, sourceUri, prepared, inputStat.size);
    try {
      mkdirSync(outputDirectory, { recursive: true });
      const files = await this.convertToParquet(inputPath, outputDirectory, prepared, importId);
      return this.metadata.completeImport(importId, prepared, files);
    } catch (error) {
      this.metadata.failImport(importId, error);
      this.removeOutputDirectory(outputDirectory);
      throw error;
    }
  }

  private async prepareImport(
    request: WarehouseImportRequest,
    inputPath: string,
  ): Promise<PreparedImport> {
    const dataset = validatePartitionValue(request.dataset, 'dataset');
    const source = validatePartitionValue(request.source, 'source');
    const market =
      request.market === undefined ? undefined : validatePartitionValue(request.market, 'market');
    const symbol =
      request.symbol === undefined
        ? undefined
        : validatePartitionValue(request.symbol.toUpperCase(), 'symbol');
    const interval =
      request.interval === undefined
        ? undefined
        : validatePartitionValue(request.interval, 'interval');
    if (request.profile === 'binance-kline' && (symbol === undefined || interval === undefined)) {
      throw new Error('binance-kline imports require symbol and interval.');
    }
    const checksumSha256 = await sha256File(inputPath);
    verifySha256(checksumSha256, request.expectedSha256);
    return {
      dataset,
      source,
      profile: request.profile,
      checksumSha256,
      ...(market === undefined ? {} : { market }),
      ...(symbol === undefined ? {} : { symbol }),
      ...(interval === undefined ? {} : { interval }),
      ...(request.hasHeader === undefined ? {} : { hasHeader: request.hasHeader }),
      ...(request.zipEntry === undefined ? {} : { zipEntry: request.zipEntry }),
      ...(request.expectedSha256 === undefined ? {} : { expectedSha256: request.expectedSha256 }),
    };
  }

  private async convertToParquet(
    inputPath: string,
    outputDirectory: string,
    request: PreparedImport,
    importId: string,
  ): Promise<ImportedParquetFile[]> {
    const extension = extname(inputPath).toLowerCase();
    let dataPath = inputPath;
    let extractedDirectory: string | undefined;
    try {
      if (extension === '.zip') {
        if (request.profile === 'parquet')
          throw new Error('ZIP archives cannot use profile=parquet.');
        extractedDirectory = mkdtempSync(join(this.tempRoot, 'extract-'));
        dataPath = await this.extractCsv(inputPath, extractedDirectory, request.zipEntry);
      }

      const dataExtension = extname(dataPath).toLowerCase();
      if (request.profile === 'parquet' && dataExtension !== '.parquet') {
        throw new Error('profile=parquet requires a .parquet file.');
      }
      if (request.profile !== 'parquet' && dataExtension !== '.csv') {
        throw new Error('CSV profiles require a .csv file or ZIP containing one CSV file.');
      }

      if (request.profile === 'binance-kline') {
        await this.writeBinanceKlines(dataPath, outputDirectory, request, importId);
      } else {
        await this.writeGenericData(dataPath, outputDirectory, request, importId);
      }
      return this.inspectParquetFiles(outputDirectory, request.profile === 'binance-kline');
    } finally {
      if (extractedDirectory !== undefined) this.removeTemporaryDirectory(extractedDirectory);
    }
  }

  private async writeBinanceKlines(
    csvPath: string,
    outputDirectory: string,
    request: PreparedImport,
    importId: string,
  ): Promise<void> {
    const importedAt = new Date().toISOString();
    // Binance archives may use milliseconds or microseconds; normalize to UTC.
    const timeExpression = (column: string) =>
      `timezone('UTC', to_timestamp(CASE WHEN abs(${column}) >= 100000000000000 ` +
      `THEN ${column} / 1000000.0 ELSE ${column} / 1000.0 END))`;
    const sql = `
      COPY (
        SELECT
          ${timeExpression('open_time')} AS open_time,
          open, high, low, close, volume,
          ${timeExpression('close_time')} AS close_time,
          quote_asset_volume, trade_count, taker_buy_base_asset_volume,
          taker_buy_quote_asset_volume,
          ${sqlString(request.dataset)} AS dataset,
          ${sqlString(request.source)} AS source,
          ${request.market === undefined ? 'NULL::VARCHAR' : sqlString(request.market)} AS market,
          ${sqlString(request.symbol ?? '')} AS symbol,
          ${sqlString(request.interval ?? '')} AS interval,
          ${sqlString(importId)} AS import_id,
          CAST(${sqlString(importedAt)} AS TIMESTAMPTZ) AS imported_at,
          year(${timeExpression('open_time')}) AS year,
          month(${timeExpression('open_time')}) AS month
        FROM read_csv(${sqlString(csvPath)}, header = false, columns = ${BINANCE_KLINE_COLUMNS},
                      strict_mode = true, null_padding = false)
        ORDER BY open_time
      ) TO ${sqlString(outputDirectory)}
        (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (year, month))`;
    await this.run(sql);
  }

  private async writeGenericData(
    inputPath: string,
    outputDirectory: string,
    request: PreparedImport,
    importId: string,
  ): Promise<void> {
    const outputPath = join(outputDirectory, 'data.parquet');
    const sourceExpression =
      request.profile === 'parquet'
        ? `read_parquet(${sqlString(inputPath)}, union_by_name = true)`
        : `read_csv_auto(${sqlString(inputPath)}, header = ${request.hasHeader ?? true}, strict_mode = true)`;
    await this.run(`
      COPY (
        SELECT *, ${sqlString(importId)} AS _warehouse_import_id,
                  CAST(${sqlString(new Date().toISOString())} AS TIMESTAMPTZ) AS _warehouse_imported_at
        FROM ${sourceExpression}
      ) TO ${sqlString(outputPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
  }

  private async extractCsv(
    zipPath: string,
    destinationDirectory: string,
    selectedName?: string,
  ): Promise<string> {
    const zip = await yauzl.openPromise(zipPath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
    });
    try {
      let selected: yauzl.Entry | undefined;
      let csvCount = 0;
      for await (const entry of zip.eachEntry()) {
        if (entry.fileName.endsWith('/') || !entry.fileName.toLowerCase().endsWith('.csv'))
          continue;
        if (selectedName !== undefined) {
          if (entry.fileName === selectedName) {
            selected = entry;
            break;
          }
          continue;
        }
        csvCount += 1;
        selected = entry;
      }
      if (selected === undefined || (selectedName === undefined && csvCount !== 1)) {
        throw new Error(
          selectedName === undefined
            ? `ZIP must contain exactly one CSV file; found ${csvCount}. Use zipEntry to select one.`
            : `ZIP entry was not found or is not a CSV file: ${selectedName}`,
        );
      }
      if (selected.uncompressedSize > this.config.WAREHOUSE_MAX_IMPORT_BYTES) {
        throw new Error('Uncompressed ZIP entry exceeds WAREHOUSE_MAX_IMPORT_BYTES.');
      }
      if (!selected.canDecodeFileData()) {
        throw new Error('ZIP entry uses an unsupported compression or encryption method.');
      }

      const input = await zip.openReadStreamPromise(selected);
      const outputPath = join(destinationDirectory, basename(selected.fileName));
      const maxImportBytes = this.config.WAREHOUSE_MAX_IMPORT_BYTES;
      let extractedBytes = 0;
      const byteLimit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          extractedBytes += chunk.length;
          if (extractedBytes > maxImportBytes) {
            callback(new Error('Uncompressed ZIP entry exceeds WAREHOUSE_MAX_IMPORT_BYTES.'));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(input, byteLimit, createWriteStream(outputPath, { flags: 'wx' }));
      return outputPath;
    } finally {
      zip.close();
    }
  }

  private async inspectParquetFiles(
    outputDirectory: string,
    hasEventTime: boolean,
  ): Promise<ImportedParquetFile[]> {
    const paths = this.findParquetFiles(outputDirectory);
    if (paths.length === 0) throw new Error('Import produced no Parquet files.');
    const results: ImportedParquetFile[] = [];
    for (const path of paths) {
      const projection = hasEventTime
        ? 'COUNT(*) AS row_count, MIN(open_time) AS min_event_time, MAX(open_time) AS max_event_time'
        : 'COUNT(*) AS row_count';
      const rows = await this.readRows(
        `SELECT ${projection} FROM read_parquet(${sqlString(path)})`,
      );
      const row = rows[0] ?? {};
      const rowCount = Number(row['row_count'] ?? 0);
      if (rowCount === 0) throw new Error('Import source contains no rows.');
      const minEventTime = this.optionalText(row['min_event_time']);
      const maxEventTime = this.optionalText(row['max_event_time']);
      const partition = this.timePartition(path);
      results.push({
        path: resolve(path),
        rowCount,
        fileSizeBytes: statSync(path).size,
        ...partition,
        ...(minEventTime === undefined ? {} : { minEventTime }),
        ...(maxEventTime === undefined ? {} : { maxEventTime }),
      });
    }
    return results;
  }

  private outputDirectory(importId: string, request: PreparedImport): string {
    const segments = [
      partitionSegment('dataset', request.dataset),
      partitionSegment('source', request.source),
      ...(request.market === undefined ? [] : [partitionSegment('market', request.market)]),
      ...(request.symbol === undefined ? [] : [partitionSegment('symbol', request.symbol)]),
      ...(request.interval === undefined ? [] : [partitionSegment('interval', request.interval)]),
      partitionSegment('import', importId),
    ];
    return join(this.parquetRoot, ...segments);
  }

  private prepareCandleSelection(selection: CandleSelection): CandleSelection {
    return {
      dataset: validatePartitionValue(selection.dataset, 'dataset'),
      symbol: validatePartitionValue(selection.symbol.toUpperCase(), 'symbol'),
      interval: validatePartitionValue(selection.interval, 'interval'),
      ...(selection.source === undefined
        ? {}
        : { source: validatePartitionValue(selection.source, 'source') }),
      ...(selection.market === undefined
        ? {}
        : { market: validatePartitionValue(selection.market, 'market') }),
    };
  }

  private existingCandleFiles(selection: CandleSelection): string[] {
    return this.metadata
      .candleFiles(selection)
      .filter((path) => existsSync(path) && isPathInside(resolve(path), this.parquetRoot));
  }

  private findParquetFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...this.findParquetFiles(path));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.parquet')) files.push(path);
    }
    return files;
  }

  private enqueueImport<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async run(sql: string): Promise<void> {
    const connection = await (await this.instance).connect();
    try {
      await connection.run(sql);
    } finally {
      connection.closeSync();
    }
  }

  private async readRows(
    sql: string,
    values?: Record<string, string>,
  ): Promise<Array<Record<string, unknown>>> {
    const connection = await (await this.instance).connect();
    try {
      const reader = await connection.runAndReadAll(sql, values);
      return reader.getRowObjectsJson() as Array<Record<string, unknown>>;
    } finally {
      connection.closeSync();
    }
  }

  private removeTemporaryDirectory(directory: string): void {
    const resolvedDirectory = resolve(directory);
    if (!isPathInside(resolvedDirectory, this.tempRoot) || resolvedDirectory === this.tempRoot) {
      throw new Error('Refused to remove a path outside the configured warehouse temp directory.');
    }
    rmSync(resolvedDirectory, { recursive: true, force: true });
  }

  private removeOutputDirectory(directory: string): void {
    const resolvedDirectory = resolve(directory);
    if (
      !isPathInside(resolvedDirectory, this.parquetRoot) ||
      resolvedDirectory === this.parquetRoot
    ) {
      throw new Error('Refused to remove a path outside the configured Parquet root.');
    }
    rmSync(resolvedDirectory, { recursive: true, force: true });
  }

  private optionalText(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  private timePartition(path: string): { year?: number; month?: number } {
    const pathDifference = path.slice(resolve(this.parquetRoot).length);
    const match = /[\\/]year=(\d{4})[\\/]month=(\d{1,2})[\\/]/.exec(pathDifference);
    if (match?.[1] === undefined || match[2] === undefined) return {};
    return { year: Number(match[1]), month: Number(match[2]) };
  }
}
