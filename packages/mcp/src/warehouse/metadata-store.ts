import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CandleSelection,
  ImportCompletion,
  ImportProfile,
  ImportedParquetFile,
  TapeFileWindow,
  WarehouseFileFilter,
  WarehouseImportRequest,
} from './types.js';

type ImportIdentity = WarehouseImportRequest & {
  checksumSha256: string;
};

type ImportRow = {
  id: string;
  dataset: string;
  source: string;
  profile: ImportCompletion['profile'];
  checksum_sha256: string;
  row_count: number;
};

type ParquetRow = {
  path: string;
  row_count: number;
  file_size_bytes: number;
  year: number | null;
  month: number | null;
  min_event_time: string | null;
  max_event_time: string | null;
};

function importOptionsKey(identity: ImportIdentity): string {
  return JSON.stringify({
    hasHeader: identity.hasHeader ?? null,
    zipEntry: identity.zipEntry ?? null,
  });
}

/** Format an ISO instant the way DuckDB renders a naive UTC timestamp column. */
function utcSecond(value: string): string {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

/** UTC calendar day of an ISO instant, matching how bounds are stored. */
function utcDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Inclusive day range. Returns an empty list when either bound is absent or reversed. */
function enumerateDays(from: string | null, to: string | null): string[] {
  if (from === null || to === null) return [];
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // A selection spanning years would otherwise build a list longer than the query is useful
  // for; two years is well past any realistic gap this tool is meant to surface.
  while (cursor <= end && days.length < 800) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export class WarehouseMetadataStore {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY,
        source_uri TEXT NOT NULL,
        dataset TEXT NOT NULL,
        source TEXT NOT NULL,
        profile TEXT NOT NULL,
        market TEXT,
        symbol TEXT,
        interval TEXT,
        options_key TEXT NOT NULL DEFAULT '{}',
        checksum_sha256 TEXT NOT NULL,
        input_size_bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        row_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS parquet_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        dataset TEXT NOT NULL,
        source TEXT NOT NULL,
        profile TEXT NOT NULL,
        market TEXT,
        symbol TEXT,
        interval TEXT,
        year INTEGER,
        month INTEGER,
        row_count INTEGER NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        min_event_time TEXT,
        max_event_time TEXT,
        created_at TEXT NOT NULL
      );

    `);
    this.ensureColumn('import_jobs', 'options_key', "TEXT NOT NULL DEFAULT '{}'");
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS import_jobs_identity_v2_idx ON import_jobs(
        checksum_sha256, dataset, source, profile, market, symbol, interval, options_key, status
      );
      CREATE INDEX IF NOT EXISTS parquet_files_selection_idx ON parquet_files(
        dataset, source, market, symbol, interval, profile
      );
    `);
  }

  public findCompleted(identity: ImportIdentity): ImportCompletion | undefined {
    const row = this.database
      .prepare(
        `SELECT id, dataset, source, profile, checksum_sha256, row_count
         FROM import_jobs
         WHERE checksum_sha256 = ? AND dataset = ? AND source = ? AND profile = ?
           AND market IS ? AND symbol IS ? AND interval IS ? AND options_key = ?
           AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 1`,
      )
      .get(
        identity.checksumSha256,
        identity.dataset,
        identity.source,
        identity.profile,
        identity.market ?? null,
        identity.symbol ?? null,
        identity.interval ?? null,
        importOptionsKey(identity),
      ) as ImportRow | undefined;
    if (row === undefined) return undefined;

    return {
      importId: row.id,
      dataset: row.dataset,
      source: row.source,
      profile: row.profile,
      checksumSha256: row.checksum_sha256,
      rowCount: Number(row.row_count),
      duplicate: true,
      files: this.filesForImport(row.id),
    };
  }

  public startImport(
    id: string,
    sourceUri: string,
    identity: ImportIdentity,
    inputSizeBytes: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO import_jobs(
           id, source_uri, dataset, source, profile, market, symbol, interval, options_key,
           checksum_sha256, input_size_bytes, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(
        id,
        sourceUri,
        identity.dataset,
        identity.source,
        identity.profile,
        identity.market ?? null,
        identity.symbol ?? null,
        identity.interval ?? null,
        importOptionsKey(identity),
        identity.checksumSha256,
        inputSizeBytes,
        new Date().toISOString(),
      );
  }

  public completeImport(
    id: string,
    identity: ImportIdentity,
    files: ImportedParquetFile[],
  ): ImportCompletion {
    const rowCount = files.reduce((sum, file) => sum + file.rowCount, 0);
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.database.prepare(
        `INSERT INTO parquet_files(
           import_id, path, dataset, source, profile, market, symbol, interval,
           year, month, row_count, file_size_bytes, min_event_time, max_event_time, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const file of files) {
        statement.run(
          id,
          file.path,
          identity.dataset,
          identity.source,
          identity.profile,
          identity.market ?? null,
          identity.symbol ?? null,
          identity.interval ?? null,
          file.year ?? null,
          file.month ?? null,
          file.rowCount,
          file.fileSizeBytes,
          file.minEventTime ?? null,
          file.maxEventTime ?? null,
          now,
        );
      }
      this.database
        .prepare(
          `UPDATE import_jobs
           SET status = 'completed', row_count = ?, completed_at = ? WHERE id = ?`,
        )
        .run(rowCount, now, id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      importId: id,
      dataset: identity.dataset,
      source: identity.source,
      profile: identity.profile,
      checksumSha256: identity.checksumSha256,
      rowCount,
      duplicate: false,
      files,
    };
  }

  public failImport(id: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.database
      .prepare(
        `UPDATE import_jobs
         SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`,
      )
      .run(message.slice(0, 2000), new Date().toISOString(), id);
  }

  public status(): Record<string, unknown> {
    const jobs = this.database
      .prepare(`SELECT status, COUNT(*) AS count FROM import_jobs GROUP BY status`)
      .all() as Array<{ status: string; count: number }>;
    const totals = this.database
      .prepare(
        `SELECT COUNT(*) AS file_count,
                COALESCE(SUM(row_count), 0) AS row_count,
                COALESCE(SUM(file_size_bytes), 0) AS file_size_bytes
         FROM parquet_files`,
      )
      .get() as { file_count: number; row_count: number; file_size_bytes: number };
    return {
      importJobs: Object.fromEntries(jobs.map((row) => [row.status, Number(row.count)])),
      parquetFileCount: Number(totals.file_count),
      rowCount: Number(totals.row_count),
      fileSizeBytes: Number(totals.file_size_bytes),
    };
  }

  public listDatasets(): unknown[] {
    return this.database
      .prepare(
        `SELECT dataset, source, profile, market, symbol, interval,
                COUNT(*) AS file_count, SUM(row_count) AS row_count,
                MIN(min_event_time) AS min_event_time,
                MAX(max_event_time) AS max_event_time
         FROM parquet_files
         GROUP BY dataset, source, profile, market, symbol, interval
         ORDER BY dataset, source, market, symbol, interval`,
      )
      .all();
  }

  public listFiles(filter: WarehouseFileFilter): unknown[] {
    const where: string[] = [];
    const values: Array<string | number> = [];
    for (const [column, value] of [
      ['dataset', filter.dataset],
      ['source', filter.source],
      ['market', filter.market],
      ['symbol', filter.symbol],
      ['interval', filter.interval],
    ] as const) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        values.push(value);
      }
    }
    values.push(filter.limit);
    return this.database
      .prepare(
        `SELECT path, dataset, source, profile, market, symbol, interval, year, month,
                row_count, file_size_bytes, min_event_time, max_event_time, created_at
         FROM parquet_files ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...values);
  }

  public candleFiles(selection: CandleSelection): string[] {
    const where = ["profile = 'binance-kline'", 'dataset = ?', 'symbol = ?', 'interval = ?'];
    const values: string[] = [selection.dataset, selection.symbol, selection.interval];
    for (const [column, value] of [
      ['source', selection.source],
      ['market', selection.market],
    ] as const) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        values.push(value);
      }
    }
    const rows = this.database
      .prepare(`SELECT path FROM parquet_files WHERE ${where.join(' AND ')} ORDER BY path`)
      .all(...values) as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  /**
   * Select tapes and series by market and, when a window is given, by file time overlap.
   * Pruning at file granularity beats the year/month axis: a one-day query would
   * otherwise read every file in the month.
   */
  public seriesFiles(
    profile: ImportProfile,
    selection: { dataset: string; market: string; symbol: string; source?: string },
    window: TapeFileWindow,
  ): string[] {
    const where = ['profile = ?', 'dataset = ?', 'market = ?', 'symbol = ?'];
    const values: string[] = [profile, selection.dataset, selection.market, selection.symbol];
    if (selection.source !== undefined) {
      where.push('source = ?');
      values.push(selection.source);
    }
    // Stored bounds look like `YYYY-MM-DD HH:MM:SS[.ffffff]` in UTC. Comparing the
    // first 19 characters keeps a fractional bound from excluding a matching file,
    // so truncation can only widen the candidate set, never drop a needed file.
    if (window.startTime !== undefined) {
      where.push('(max_event_time IS NULL OR substr(max_event_time, 1, 19) >= ?)');
      values.push(utcSecond(window.startTime));
    }
    if (window.endTime !== undefined) {
      where.push('(min_event_time IS NULL OR substr(min_event_time, 1, 19) <= ?)');
      values.push(utcSecond(window.endTime));
    }
    const rows = this.database
      .prepare(`SELECT path FROM parquet_files WHERE ${where.join(' AND ')} ORDER BY path`)
      .all(...values) as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  /**
   * Per-day coverage for one selection, derived from the file-level time bounds already in
   * `parquet_files`. `listDatasets` collapses a selection to a single MIN/MAX pair, which
   * reads as continuous coverage even when whole days in the middle were never imported;
   * this keeps the gaps visible without scanning any parquet payload.
   *
   * A day counts as covered when some file's bounds touch it, so a partially imported day
   * is reported as covered. That is the intent: the answer is "is there tape for this day",
   * and `dataRange` is the tool that measures how complete a covered day is.
   */
  public coverageGaps(
    selection: {
      profile?: ImportProfile;
      dataset: string;
      source?: string;
      market?: string;
      symbol?: string;
    },
    window: TapeFileWindow = {},
  ): Record<string, unknown> {
    const where: string[] = ['dataset = ?'];
    const values: string[] = [selection.dataset];
    for (const [column, value] of [
      ['profile', selection.profile],
      ['source', selection.source],
      ['market', selection.market],
      ['symbol', selection.symbol],
    ] as const) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (window.startTime !== undefined) {
      where.push('(max_event_time IS NULL OR substr(max_event_time, 1, 19) >= ?)');
      values.push(utcSecond(window.startTime));
    }
    if (window.endTime !== undefined) {
      where.push('(min_event_time IS NULL OR substr(min_event_time, 1, 19) <= ?)');
      values.push(utcSecond(window.endTime));
    }
    const rows = this.database
      .prepare(
        `SELECT substr(min_event_time, 1, 10) AS min_day,
                substr(max_event_time, 1, 10) AS max_day,
                COUNT(*) AS file_count
         FROM parquet_files ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           AND min_event_time IS NOT NULL AND max_event_time IS NOT NULL
         GROUP BY 1, 2 ORDER BY 1`,
      )
      .all(...values) as Array<{ min_day: string; max_day: string; file_count: number }>;

    const covered = new Set<string>();
    for (const row of rows) {
      for (const day of enumerateDays(row.min_day, row.max_day)) covered.add(day);
    }
    const coveredDays = [...covered].sort();
    const firstDay = coveredDays[0] ?? null;
    const lastDay = coveredDays.at(-1) ?? null;
    // With no window the expected range is the selection's own span, which is exactly the
    // case that matters: a gap between the first and last imported day is otherwise
    // invisible behind a min/max pair.
    const expected = enumerateDays(
      window.startTime === undefined ? firstDay : utcDay(window.startTime),
      window.endTime === undefined ? lastDay : utcDay(window.endTime),
    );
    const missingDays = expected.filter((day) => !covered.has(day));
    return {
      coveredDayCount: coveredDays.length,
      firstDay,
      lastDay,
      expectedDayCount: expected.length,
      missingDays,
      missingDayCount: missingDays.length,
      coveredDays,
    };
  }

  public close(): void {
    this.database.close();
  }

  private filesForImport(importId: string): ImportedParquetFile[] {
    const rows = this.database
      .prepare(
        `SELECT path, row_count, file_size_bytes, year, month, min_event_time, max_event_time
         FROM parquet_files WHERE import_id = ? ORDER BY path`,
      )
      .all(importId) as ParquetRow[];
    return rows.map((row) => ({
      path: row.path,
      rowCount: Number(row.row_count),
      fileSizeBytes: Number(row.file_size_bytes),
      ...(row.year === null ? {} : { year: Number(row.year) }),
      ...(row.month === null ? {} : { month: Number(row.month) }),
      ...(row.min_event_time === null ? {} : { minEventTime: row.min_event_time }),
      ...(row.max_event_time === null ? {} : { maxEventTime: row.max_event_time }),
    }));
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
