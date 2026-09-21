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
  ImportProfile,
  ImportedParquetFile,
  SeriesDataset,
  SeriesQuery,
  SeriesSelection,
  TapeDataset,
  TapeFileWindow,
  TapeMarket,
  TapeQuery,
  TapeSelection,
  WarehouseFileFilter,
  WarehouseImportFileRequest,
  WarehouseImportRequest,
  WarehouseImportUrlRequest,
} from './types.js';
import {
  SERIES_PROFILE_FOR_DATASET,
  TAPE_PROFILE_FOR_DATASET,
  isSeriesDataset,
  isTapeDataset,
  isTapeMarket,
  seriesDatasetForProfile,
  tapeDatasetForProfile,
} from './types.js';

type PreparedImport = WarehouseImportRequest & {
  checksumSha256: string;
};

type PreparedTapeSelection = TapeSelection & {
  dataset: TapeDataset;
  market: TapeMarket;
};

type PreparedSeriesSelection = SeriesSelection & {
  dataset: SeriesDataset;
  market: 'um';
};

type TapeQueryMode = 'rows' | 'buckets' | 'prices';

type TapeVariant = {
  /** Binance writes a header row for USD-M files and none for Spot files. */
  header: boolean;
  /** read_csv columns struct; the order must match the file exactly. */
  columns: string;
  timeColumn: string;
  /** Projection before event_time, aliasing source names onto the shared schema. */
  leading: string;
  /** Projection after event_time, including columns absent from this market. */
  trailing: string;
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
 * Binance batch CSVs read booleans as `False`/`True` on Spot and `true`/`false` on
 * USD-M. Read the column as text and map it explicitly rather than trusting inference.
 */
const booleanExpression = (column: string) =>
  `CASE WHEN lower(${column}) IN ('true','1') THEN true ` +
  `WHEN lower(${column}) IN ('false','0') THEN false END`;

const tapeTimeExpression = (column: string) =>
  `timezone('UTC', to_timestamp(CASE WHEN abs(${column}) >= 100000000000000 ` +
  `THEN ${column} / 1000000.0 ELSE ${column} / 1000.0 END))`;

/**
 * One entry per dataset x market. The `columns` struct is positional, so each variant
 * must list exactly the file's columns in order: spot trades 7, um trades 6,
 * spot aggTrades 8, um aggTrades 7. Those counts are distinct, which makes a
 * mislabelled market fail loudly instead of importing the wrong data.
 */
const TAPE_VARIANTS: Record<TapeDataset, Record<TapeMarket, TapeVariant>> = {
  trades: {
    spot: {
      header: false,
      columns:
        `{'tradeId':'BIGINT','price':'DOUBLE','qty':'DOUBLE','quoteQty':'DOUBLE',` +
        `'time':'BIGINT','isBuyerMaker':'VARCHAR','isBestMatch':'VARCHAR'}`,
      timeColumn: 'time',
      leading: 'tradeId AS trade_id, price, qty, quoteQty AS quote_qty',
      trailing:
        `${booleanExpression('isBuyerMaker')} AS is_buyer_maker, ` +
        `${booleanExpression('isBestMatch')} AS is_best_match`,
    },
    um: {
      header: true,
      columns:
        `{'id':'BIGINT','price':'DOUBLE','qty':'DOUBLE','quote_qty':'DOUBLE',` +
        `'time':'BIGINT','is_buyer_maker':'VARCHAR'}`,
      timeColumn: 'time',
      leading: 'id AS trade_id, price, qty, quote_qty',
      trailing:
        `${booleanExpression('is_buyer_maker')} AS is_buyer_maker, ` +
        `NULL::BOOLEAN AS is_best_match`,
    },
  },
  aggtrades: {
    spot: {
      header: false,
      columns:
        `{'aggTradeId':'BIGINT','price':'DOUBLE','qty':'DOUBLE','firstTradeId':'BIGINT',` +
        `'lastTradeId':'BIGINT','time':'BIGINT','isBuyerMaker':'VARCHAR','isBestMatch':'VARCHAR'}`,
      timeColumn: 'time',
      leading:
        'aggTradeId AS agg_trade_id, price, qty, firstTradeId AS first_trade_id, ' +
        'lastTradeId AS last_trade_id',
      // Binance publishes no quote quantity for aggregate trades; leave it NULL rather
      // than inventing a value the source does not carry.
      trailing:
        `NULL::DOUBLE AS quote_qty, ` +
        `${booleanExpression('isBuyerMaker')} AS is_buyer_maker, ` +
        `${booleanExpression('isBestMatch')} AS is_best_match`,
    },
    um: {
      header: true,
      columns:
        `{'agg_trade_id':'BIGINT','price':'DOUBLE','quantity':'DOUBLE',` +
        `'first_trade_id':'BIGINT','last_trade_id':'BIGINT','transact_time':'BIGINT',` +
        `'is_buyer_maker':'VARCHAR'}`,
      timeColumn: 'transact_time',
      leading: 'agg_trade_id, price, quantity AS qty, first_trade_id, last_trade_id',
      trailing:
        `NULL::DOUBLE AS quote_qty, ` +
        `${booleanExpression('is_buyer_maker')} AS is_buyer_maker, ` +
        `NULL::BOOLEAN AS is_best_match`,
    },
  },
};

/** Spot and USD-M trade IDs are independent sequences; the market is part of the key. */
const TAPE_PRIMARY_KEYS: Record<TapeDataset, string> = {
  trades: 'trade_id',
  aggtrades: 'agg_trade_id',
};

/**
 * Snapshot datasets. Their source timestamp is a naive UTC string (`2026-08-01 00:00:00`),
 * not an epoch number, so the magnitude heuristic used for Klines and tape does not apply
 * and the column is cast directly. Both are stored under the shared `event_time` name.
 */
type SeriesVariant = {
  timeColumn: string;
  /** Dedup key columns beyond (market, symbol, event_time). */
  keyColumns: readonly string[];
  /** read_csv columns struct; the order must match the file exactly. */
  columns: string;
  projection: string;
  /** Numeric columns that bucketed queries aggregate per bucket. */
  valueColumns: readonly string[];
};

const SERIES_VARIANTS: Record<SeriesDataset, SeriesVariant> = {
  metrics: {
    timeColumn: 'create_time',
    keyColumns: [],
    columns:
      `{'create_time':'VARCHAR','symbol':'VARCHAR','sum_open_interest':'DOUBLE',` +
      `'sum_open_interest_value':'DOUBLE','count_toptrader_long_short_ratio':'DOUBLE',` +
      `'sum_toptrader_long_short_ratio':'DOUBLE','count_long_short_ratio':'DOUBLE',` +
      `'sum_taker_long_short_vol_ratio':'DOUBLE'}`,
    // The source `symbol` column is redundant with the partition value and is dropped.
    projection:
      'CAST(create_time AS TIMESTAMP) AS event_time, sum_open_interest, ' +
      'sum_open_interest_value, count_toptrader_long_short_ratio, ' +
      'sum_toptrader_long_short_ratio, count_long_short_ratio, ' +
      'sum_taker_long_short_vol_ratio',
    valueColumns: [
      'sum_open_interest',
      'sum_open_interest_value',
      'count_toptrader_long_short_ratio',
      'sum_toptrader_long_short_ratio',
      'count_long_short_ratio',
      'sum_taker_long_short_vol_ratio',
    ],
  },
  bookdepth: {
    timeColumn: 'timestamp',
    keyColumns: ['percentage'],
    columns: `{'timestamp':'VARCHAR','percentage':'DOUBLE','depth':'DOUBLE','notional':'DOUBLE'}`,
    projection: 'CAST(timestamp AS TIMESTAMP) AS event_time, percentage, depth, notional',
    valueColumns: ['depth', 'notional'],
  },
};

function timeColumnForProfile(profile: ImportProfile): string | undefined {
  if (profile === 'binance-kline') return 'open_time';
  if (tapeDatasetForProfile(profile) !== undefined) return 'event_time';
  if (seriesDatasetForProfile(profile) !== undefined) return 'event_time';
  return undefined;
}

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
    // temp_directory and memory_limit are instance-wide in DuckDB, so setting them once
    // here covers every short-lived connection this service opens for imports and queries.
    this.instance = DuckDBInstance.create(':memory:', {
      temp_directory: this.tempRoot,
      ...(config.WAREHOUSE_DUCKDB_MEMORY_LIMIT === undefined
        ? {}
        : { memory_limit: config.WAREHOUSE_DUCKDB_MEMORY_LIMIT }),
    });
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

  /**
   * Row-level tape query, bucketed aggregation when `bucketSeconds` is set, or per-price
   * aggregation when `groupBy` is `'price'`.
   */
  public async queryTrades(query: TapeQuery): Promise<unknown[]> {
    const prepared = this.prepareTapeSelection(query);
    if (query.groupBy !== undefined && query.groupBy !== 'price') {
      throw new Error("groupBy only accepts 'price'.");
    }
    const bucketSeconds = query.bucketSeconds;
    if (query.groupBy === 'price') {
      if (bucketSeconds === undefined) {
        throw new Error(
          'groupBy=price requires bucketSeconds; without it the result is every price ' +
            'level over the whole window.',
        );
      }
      this.validateTapeFilters(prepared, query, 'prices');
      return this.queryTapePrices(prepared, query, bucketSeconds);
    }
    if (bucketSeconds === undefined) {
      this.validateTapeFilters(prepared, query, 'rows');
      return this.queryTapeRows(prepared, query);
    }
    this.validateTapeFilters(prepared, query, 'buckets');
    return this.queryTapeBuckets(prepared, query, bucketSeconds);
  }

  public async tapeDataRange(selection: TapeSelection): Promise<Record<string, unknown>> {
    const prepared = this.prepareTapeSelection(selection);
    const files = this.existingTapeFiles(prepared, {});
    if (files.length === 0) {
      return { ...prepared, rowCount: 0, minEventTime: null, maxEventTime: null };
    }
    const rows = await this.readRows(`
      WITH deduplicated AS (
        SELECT event_time, market
        FROM read_parquet([${files.map(sqlString).join(', ')}], union_by_name = true)
        QUALIFY row_number() OVER (
          PARTITION BY market, ${TAPE_PRIMARY_KEYS[prepared.dataset]} ORDER BY imported_at DESC
        ) = 1
      )
      SELECT COUNT(*) AS row_count, MIN(event_time) AS min_event_time,
             MAX(event_time) AS max_event_time
      FROM deduplicated`);
    const row = rows[0];
    return {
      ...prepared,
      rowCount: Number(row?.['row_count'] ?? 0),
      minEventTime: this.optionalText(row?.['min_event_time']) ?? null,
      maxEventTime: this.optionalText(row?.['max_event_time']) ?? null,
    };
  }

  /**
   * Snapshot series query. Row level by default; per-bucket averages when `bucketSeconds`
   * is set. Bucket rows keep any extra key column (book depth keeps its percentage band),
   * so aggregating never averages across bands.
   */
  public async querySeries(query: SeriesQuery): Promise<unknown[]> {
    const prepared = this.prepareSeriesSelection(query);
    const variant = SERIES_VARIANTS[prepared.dataset];
    if (query.percentage !== undefined && prepared.dataset !== 'bookdepth') {
      throw new Error('percentage is only available for the bookdepth dataset.');
    }
    const files = this.existingSeriesFiles(prepared, query);
    if (files.length === 0) return [];

    const conditions: string[] = [];
    const values: Record<string, string> = {};
    if (query.startTime !== undefined) {
      conditions.push("event_time >= timezone('UTC', CAST($startTime AS TIMESTAMPTZ))");
      values['startTime'] = query.startTime;
    }
    if (query.endTime !== undefined) {
      conditions.push("event_time <= timezone('UTC', CAST($endTime AS TIMESTAMPTZ))");
      values['endTime'] = query.endTime;
    }
    if (query.percentage !== undefined) {
      if (!Number.isFinite(query.percentage)) {
        throw new Error('percentage must be a finite number.');
      }
      conditions.push(`percentage = ${query.percentage}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Series rows carry no synthetic ID, so the natural key is the dedup key.
    const dedupKey = ['market', 'symbol', 'event_time', ...variant.keyColumns].join(', ');
    const fileList = files.map(sqlString).join(', ');
    const selected = ['event_time', ...variant.keyColumns, ...variant.valueColumns].join(', ');

    if (query.bucketSeconds === undefined) {
      return this.readRows(
        `SELECT ${selected}, dataset, source, market, symbol
         FROM read_parquet([${fileList}], union_by_name = true)
         ${where}
         QUALIFY row_number() OVER (PARTITION BY ${dedupKey} ORDER BY imported_at DESC) = 1
         ORDER BY event_time DESC
         LIMIT ${query.limit}`,
        values,
      );
    }

    const aggregates = variant.valueColumns
      .flatMap((column) => [
        `avg(${column}) AS ${column}_avg`,
        `min(${column}) AS ${column}_min`,
        `max(${column}) AS ${column}_max`,
        `arg_max(${column}, event_time) AS ${column}_last`,
      ])
      .join(',\n             ');
    const keySelect = variant.keyColumns.length > 0 ? `, ${variant.keyColumns.join(', ')}` : '';
    const groupBy = ['1', ...variant.keyColumns.map((_, index) => String(index + 2))].join(', ');
    const sql = `
      WITH deduplicated AS (
        SELECT ${selected}, market, symbol
        FROM read_parquet([${fileList}], union_by_name = true)
        ${where}
        QUALIFY row_number() OVER (PARTITION BY ${dedupKey} ORDER BY imported_at DESC) = 1
      )
      SELECT time_bucket(INTERVAL '${query.bucketSeconds} seconds', event_time) AS bucket_start${keySelect},
             ${aggregates}
      FROM deduplicated
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      LIMIT ${query.limit + 1}`;
    const rows = await this.readRows(sql, values);
    if (rows.length > query.limit) {
      throw new Error(
        `Series query matched more than ${query.limit} rows. ` +
          'Narrow startTime/endTime, raise bucketSeconds, or raise limit.',
      );
    }
    return rows;
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
    if (tapeDatasetForProfile(request.profile) !== undefined) {
      const expectedDataset = tapeDatasetForProfile(request.profile);
      if (dataset !== expectedDataset) {
        throw new Error(`${request.profile} imports require dataset '${expectedDataset}'.`);
      }
      if (market === undefined || symbol === undefined) {
        throw new Error(`${request.profile} imports require market and symbol.`);
      }
      if (!isTapeMarket(market)) {
        throw new Error(`${request.profile} imports require market 'spot' or 'um'.`);
      }
      if (interval !== undefined) {
        throw new Error(`${request.profile} imports do not accept interval.`);
      }
      if (request.hasHeader !== undefined) {
        throw new Error(`${request.profile} imports do not accept hasHeader.`);
      }
    }
    const seriesDataset = seriesDatasetForProfile(request.profile);
    if (seriesDataset !== undefined) {
      if (dataset !== seriesDataset) {
        throw new Error(`${request.profile} imports require dataset '${seriesDataset}'.`);
      }
      if (market === undefined || symbol === undefined) {
        throw new Error(`${request.profile} imports require market and symbol.`);
      }
      // Binance publishes both series datasets for USD-M only.
      if (market !== 'um') {
        throw new Error(`${request.profile} imports require market 'um'.`);
      }
      if (interval !== undefined) {
        throw new Error(`${request.profile} imports do not accept interval.`);
      }
      if (request.hasHeader !== undefined) {
        throw new Error(`${request.profile} imports do not accept hasHeader.`);
      }
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
      } else if (tapeDatasetForProfile(request.profile) !== undefined) {
        await this.writeBinanceTape(dataPath, outputDirectory, request, importId);
      } else if (seriesDatasetForProfile(request.profile) !== undefined) {
        await this.writeBinanceSeries(dataPath, outputDirectory, request, importId);
      } else {
        await this.writeGenericData(dataPath, outputDirectory, request, importId);
      }
      return this.inspectParquetFiles(outputDirectory, timeColumnForProfile(request.profile));
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

  private async writeBinanceTape(
    csvPath: string,
    outputDirectory: string,
    request: PreparedImport,
    importId: string,
  ): Promise<void> {
    const dataset = tapeDatasetForProfile(request.profile);
    const market = request.market === undefined ? undefined : request.market;
    if (dataset === undefined || market === undefined || !isTapeMarket(market)) {
      throw new Error('Tape conversion requires a validated dataset and market.');
    }
    const variant = TAPE_VARIANTS[dataset][market];
    const sql = `
      COPY (
        SELECT
          ${variant.leading},
          ${tapeTimeExpression(variant.timeColumn)} AS event_time,
          ${variant.trailing},
          ${sqlString(request.dataset)} AS dataset,
          ${sqlString(request.source)} AS source,
          ${sqlString(market)} AS market,
          ${sqlString(request.symbol ?? '')} AS symbol,
          ${sqlString(importId)} AS import_id,
          CAST(${sqlString(new Date().toISOString())} AS TIMESTAMPTZ) AS imported_at,
          year(event_time) AS year,
          month(event_time) AS month
        FROM read_csv(${sqlString(csvPath)}, header = ${variant.header},
                      columns = ${variant.columns}, strict_mode = true, null_padding = false)
      ) TO ${sqlString(outputDirectory)}
        (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (year, month))`;
    await this.run(sql);
  }

  private async writeBinanceSeries(
    csvPath: string,
    outputDirectory: string,
    request: PreparedImport,
    importId: string,
  ): Promise<void> {
    const dataset = seriesDatasetForProfile(request.profile);
    if (dataset === undefined) {
      throw new Error('Series conversion requires a validated series profile.');
    }
    const variant = SERIES_VARIANTS[dataset];
    const sql = `
      COPY (
        SELECT
          ${variant.projection},
          ${sqlString(request.dataset)} AS dataset,
          ${sqlString(request.source)} AS source,
          ${sqlString(request.market ?? '')} AS market,
          ${sqlString(request.symbol ?? '')} AS symbol,
          ${sqlString(importId)} AS import_id,
          CAST(${sqlString(new Date().toISOString())} AS TIMESTAMPTZ) AS imported_at,
          year(event_time) AS year,
          month(event_time) AS month
        FROM read_csv(${sqlString(csvPath)}, header = true,
                      columns = ${variant.columns}, strict_mode = true, null_padding = false)
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
    timeColumn?: string,
  ): Promise<ImportedParquetFile[]> {
    const paths = this.findParquetFiles(outputDirectory);
    if (paths.length === 0) throw new Error('Import produced no Parquet files.');
    const results: ImportedParquetFile[] = [];
    for (const path of paths) {
      const projection =
        timeColumn === undefined
          ? 'COUNT(*) AS row_count'
          : `COUNT(*) AS row_count, MIN(${timeColumn}) AS min_event_time, ` +
            `MAX(${timeColumn}) AS max_event_time`;
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

  private prepareTapeSelection(selection: TapeSelection): PreparedTapeSelection {
    const dataset = validatePartitionValue(selection.dataset, 'dataset');
    if (!isTapeDataset(dataset)) {
      throw new Error("dataset must be 'trades' or 'aggtrades'.");
    }
    const market = validatePartitionValue(selection.market, 'market');
    if (!isTapeMarket(market)) {
      throw new Error("market must be 'spot' or 'um'.");
    }
    return {
      dataset,
      market,
      symbol: validatePartitionValue(selection.symbol.toUpperCase(), 'symbol'),
      ...(selection.source === undefined
        ? {}
        : { source: validatePartitionValue(selection.source, 'source') }),
    };
  }

  private existingTapeFiles(selection: PreparedTapeSelection, window: TapeFileWindow): string[] {
    return this.metadata
      .seriesFiles(TAPE_PROFILE_FOR_DATASET[selection.dataset], selection, window)
      .filter((path) => existsSync(path) && isPathInside(resolve(path), this.parquetRoot));
  }

  private prepareSeriesSelection(selection: SeriesSelection): PreparedSeriesSelection {
    const dataset = validatePartitionValue(selection.dataset, 'dataset');
    if (!isSeriesDataset(dataset)) {
      throw new Error("dataset must be 'metrics' or 'bookdepth'.");
    }
    const market = validatePartitionValue(selection.market, 'market');
    if (market !== 'um') {
      throw new Error(
        "market must be 'um'; Binance publishes the metrics and bookDepth datasets for USD-M only.",
      );
    }
    return {
      dataset,
      market,
      symbol: validatePartitionValue(selection.symbol.toUpperCase(), 'symbol'),
      ...(selection.source === undefined
        ? {}
        : { source: validatePartitionValue(selection.source, 'source') }),
    };
  }

  private existingSeriesFiles(
    selection: PreparedSeriesSelection,
    window: TapeFileWindow,
  ): string[] {
    return this.metadata
      .seriesFiles(SERIES_PROFILE_FOR_DATASET[selection.dataset], selection, window)
      .filter((path) => existsSync(path) && isPathInside(resolve(path), this.parquetRoot));
  }

  /** Resting orders consumed by one aggressor order; only aggregate trades can express it. */
  private tapeSpanExpression(dataset: TapeDataset): string {
    return dataset === 'aggtrades'
      ? 'CAST(last_trade_id AS BIGINT) - CAST(first_trade_id AS BIGINT) + 1'
      : '1';
  }

  /**
   * `minNotional` and `minSpan` mean "what counts as large" and "what counts as a sweep".
   * Row-level queries return only the rows that qualify. Bucketed and per-price queries
   * keep the whole population, because filtering there would silently redefine the bucket
   * totals — so a filter that has no meaning in those modes is rejected, never ignored.
   */
  private validateTapeFilters(
    selection: PreparedTapeSelection,
    query: TapeQuery,
    mode: TapeQueryMode,
  ): void {
    if (query.minNotional !== undefined) {
      if (!Number.isFinite(query.minNotional) || query.minNotional < 0) {
        throw new Error('minNotional must be a non-negative number.');
      }
      if (mode === 'prices') {
        throw new Error(
          'minNotional applies to row-level and bucketed queries, not to groupBy=price.',
        );
      }
    }
    if (query.minSpan !== undefined) {
      // Raw trades store one fill per row, so "how many resting orders were consumed"
      // has no meaning there.
      if (selection.dataset !== 'aggtrades') {
        throw new Error('minSpan is only available for the aggtrades dataset.');
      }
      if (!Number.isInteger(query.minSpan) || query.minSpan < 1) {
        throw new Error('minSpan must be a positive integer.');
      }
      if (mode !== 'rows') {
        throw new Error('minSpan applies to row-level queries only.');
      }
    }
    if (mode === 'prices' && (query.startTime === undefined || query.endTime === undefined)) {
      throw new Error(
        'groupBy=price requires both startTime and endTime; without a bounded window it ' +
          "reads the symbol's entire history before the row cap can reject it.",
      );
    }
    // A price band is a scope, not a definition, so it is deliberately allowed in every
    // mode: everything inside the band still aggregates over the whole population there.
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const bounds = [query.minPrice, query.maxPrice].filter(
        (value): value is number => value !== undefined,
      );
      if (bounds.some((value) => !Number.isFinite(value) || value < 0)) {
        throw new Error('minPrice and maxPrice must be non-negative numbers.');
      }
      if (
        query.minPrice !== undefined &&
        query.maxPrice !== undefined &&
        query.minPrice > query.maxPrice
      ) {
        throw new Error('minPrice must not exceed maxPrice.');
      }
    }
  }

  /**
   * `event_time` is a naive UTC TIMESTAMP, so bounds must be converted with the same
   * expression the import used. Comparing raw strings would silently shift any
   * offset-bearing input such as `+08:00`.
   *
   * The large-order filters use `price * qty` rather than `quote_qty`, because aggregate
   * trades carry no quote quantity and the filter would silently match nothing.
   *
   * The price band applies to every mode, so all aggregates describe the band rather than
   * the symbol; callers must state the band alongside any result drawn from it.
   */
  private tapeConditions(
    selection: PreparedTapeSelection,
    query: TapeQuery,
    mode: TapeQueryMode,
  ): {
    clause: string;
    values: Record<string, string>;
  } {
    const conditions: string[] = [];
    const values: Record<string, string> = {};
    if (query.startTime !== undefined) {
      conditions.push("event_time >= timezone('UTC', CAST($startTime AS TIMESTAMPTZ))");
      values['startTime'] = query.startTime;
    }
    if (query.endTime !== undefined) {
      conditions.push("event_time <= timezone('UTC', CAST($endTime AS TIMESTAMPTZ))");
      values['endTime'] = query.endTime;
    }
    // The price band scopes every mode, so it sits outside the row-only block below.
    if (query.minPrice !== undefined) {
      conditions.push(`price >= ${query.minPrice}`);
    }
    if (query.maxPrice !== undefined) {
      conditions.push(`price <= ${query.maxPrice}`);
    }
    if (mode === 'rows') {
      if (query.minNotional !== undefined) {
        conditions.push(`price * qty >= ${query.minNotional}`);
      }
      if (query.minSpan !== undefined) {
        conditions.push(`${this.tapeSpanExpression(selection.dataset)} >= ${query.minSpan}`);
      }
    }
    return { clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', values };
  }

  private tapeIdColumns(dataset: TapeDataset): string {
    return dataset === 'trades' ? 'trade_id' : 'agg_trade_id, first_trade_id, last_trade_id';
  }

  private async queryTapeRows(
    selection: PreparedTapeSelection,
    query: TapeQuery,
  ): Promise<unknown[]> {
    const files = this.existingTapeFiles(selection, query);
    if (files.length === 0) return [];
    const { clause, values } = this.tapeConditions(selection, query, 'rows');
    const spanColumn =
      selection.dataset === 'aggtrades'
        ? `, ${this.tapeSpanExpression(selection.dataset)} AS span`
        : '';
    const sql = `
      SELECT ${this.tapeIdColumns(selection.dataset)}${spanColumn}, price, qty, quote_qty,
             event_time, is_buyer_maker, is_best_match, dataset, source, market, symbol
      FROM read_parquet([${files.map(sqlString).join(', ')}], union_by_name = true)
      ${clause}
      QUALIFY row_number() OVER (
        PARTITION BY market, ${TAPE_PRIMARY_KEYS[selection.dataset]} ORDER BY imported_at DESC
      ) = 1
      ORDER BY event_time DESC
      LIMIT ${query.limit}`;
    return this.readRows(sql, values);
  }

  private async queryTapeBuckets(
    selection: PreparedTapeSelection,
    query: TapeQuery,
    bucketSeconds: number,
  ): Promise<unknown[]> {
    const files = this.existingTapeFiles(selection, query);
    if (files.length === 0) return [];
    const { clause, values } = this.tapeConditions(selection, query, 'buckets');
    // The threshold defaults to zero, so the large-order columns degrade to the bucket
    // totals rather than disappearing. It deliberately does not filter rows: the bucket
    // totals must stay the whole population. A stable output schema is worth the
    // redundancy.
    const threshold = query.minNotional ?? 0;
    // Deduplicate in a subquery first: DuckDB evaluates QUALIFY after GROUP BY, so a
    // single-level query would deduplicate buckets instead of trades and double-count
    // re-published archives.
    const sql = `
      WITH deduplicated AS (
        SELECT price, qty, event_time, is_buyer_maker, market
        FROM read_parquet([${files.map(sqlString).join(', ')}], union_by_name = true)
        ${clause}
        QUALIFY row_number() OVER (
          PARTITION BY market, ${TAPE_PRIMARY_KEYS[selection.dataset]} ORDER BY imported_at DESC
        ) = 1
      ),
      bucketed AS (
        SELECT time_bucket(INTERVAL '${bucketSeconds} seconds', event_time) AS bucket_start,
               count(*) AS trade_count,
               sum(qty) AS volume,
               sum(price * qty) AS quote_volume,
               sum(price * qty) / nullif(sum(qty), 0) AS vwap,
               sum(CASE WHEN is_buyer_maker THEN 0 ELSE qty END) AS taker_buy_volume,
               sum(CASE WHEN is_buyer_maker THEN qty ELSE 0 END) AS taker_sell_volume,
               (taker_buy_volume - taker_sell_volume)
                 / nullif(taker_buy_volume + taker_sell_volume, 0) AS taker_imbalance,
               count(*) FILTER (WHERE price * qty >= ${threshold}) AS large_trade_count,
               sum(price * qty) FILTER (WHERE price * qty >= ${threshold}) AS large_trade_notional,
               arg_min(price, event_time) AS open,
               arg_max(price, event_time) AS close,
               max(price) AS high,
               min(price) AS low
        FROM deduplicated
        GROUP BY 1
      )
      -- taker_delta is the per-bucket net aggression. cvd accumulates it across the whole
      -- result set, so its absolute value is anchored to the requested window's start,
      -- not to a session or a day. Callers must not compare cvd across windows with
      -- different start times.
      SELECT *,
             (taker_buy_volume - taker_sell_volume) AS taker_delta,
             sum(taker_buy_volume - taker_sell_volume) OVER (ORDER BY bucket_start ASC) AS cvd
      FROM bucketed
      ORDER BY bucket_start ASC
      LIMIT ${query.limit + 1}`;
    const rows = await this.readRows(sql, values);
    if (rows.length > query.limit) {
      throw new Error(
        `Bucket query matched more than ${query.limit} buckets. ` +
          'Narrow startTime/endTime or raise bucketSeconds.',
      );
    }
    return rows;
  }

  /**
   * Footprint view: one row per price level inside each bucket, with the taker split and
   * the net delta. Repeated hits at one level while price does not progress is the
   * signature that iceberg and absorption claims rest on, so the hit count and the time
   * span are reported alongside the volumes.
   */
  private async queryTapePrices(
    selection: PreparedTapeSelection,
    query: TapeQuery,
    bucketSeconds: number,
  ): Promise<unknown[]> {
    const files = this.existingTapeFiles(selection, query);
    if (files.length === 0) return [];
    const { clause, values } = this.tapeConditions(selection, query, 'prices');
    const sql = `
      WITH deduplicated AS (
        SELECT price, qty, event_time, is_buyer_maker, market
        FROM read_parquet([${files.map(sqlString).join(', ')}], union_by_name = true)
        ${clause}
        QUALIFY row_number() OVER (
          PARTITION BY market, ${TAPE_PRIMARY_KEYS[selection.dataset]} ORDER BY imported_at DESC
        ) = 1
      )
      -- One row per level rather than one per level and side: the footprint reads
      -- directly, and ordering by volume keeps the liquid levels if the cap is hit.
      SELECT time_bucket(INTERVAL '${bucketSeconds} seconds', event_time) AS bucket_start,
             price,
             sum(CASE WHEN is_buyer_maker THEN 0 ELSE qty END) AS taker_buy_volume,
             sum(CASE WHEN is_buyer_maker THEN qty ELSE 0 END) AS taker_sell_volume,
             sum(CASE WHEN is_buyer_maker THEN -qty ELSE qty END) AS delta,
             sum(qty) AS volume,
             count(*) AS trade_count,
             min(event_time) AS first_event_time,
             max(event_time) AS last_event_time
      FROM deduplicated
      GROUP BY 1, 2
      ORDER BY bucket_start ASC, volume DESC
      LIMIT ${query.limit + 1}`;
    const rows = await this.readRows(sql, values);
    if (rows.length > query.limit) {
      throw new Error(
        `Price-level query matched more than ${query.limit} rows. ` +
          'Narrow startTime/endTime, raise bucketSeconds, or raise limit.',
      );
    }
    return rows;
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
