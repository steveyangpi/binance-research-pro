import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CacheStore } from './cache-store.js';

type CacheRow = {
  value_json: string;
  expires_at: number;
};

/** Persistent JSON response cache backed by the Node.js built-in SQLite driver. */
export class SqliteCache implements CacheStore {
  private readonly database: DatabaseSync;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private writesSinceCleanup = 0;

  public constructor(
    databasePath: string,
    private readonly maxEntries: number,
  ) {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cache_entries_expires_at_idx
        ON cache_entries(expires_at);
    `);
  }

  public async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.read<T>(key);
    if (cached !== undefined) return cached;

    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending !== undefined) return pending;

    const loadPromise = loader().then((value) => {
      this.write(key, value, ttlMs);
      return value;
    });
    this.inFlight.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  public close(): void {
    this.database.close();
  }

  private read<T>(key: string): T | undefined {
    const row = this.database
      .prepare('SELECT value_json, expires_at FROM cache_entries WHERE key = ?')
      .get(key) as CacheRow | undefined;
    if (row === undefined) return undefined;
    if (row.expires_at <= Date.now()) {
      this.database.prepare('DELETE FROM cache_entries WHERE key = ?').run(key);
      return undefined;
    }
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      this.database.prepare('DELETE FROM cache_entries WHERE key = ?').run(key);
      return undefined;
    }
  }

  private write<T>(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO cache_entries(key, value_json, expires_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now + ttlMs, now);

    this.writesSinceCleanup += 1;
    if (this.writesSinceCleanup >= 50) {
      this.cleanup(now);
      this.writesSinceCleanup = 0;
    }
  }

  private cleanup(now: number): void {
    this.database.prepare('DELETE FROM cache_entries WHERE expires_at <= ?').run(now);
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM cache_entries').get() as {
      count: number;
    };
    const excess = Number(row.count) - this.maxEntries;
    if (excess > 0) {
      this.database
        .prepare(
          `DELETE FROM cache_entries
           WHERE key IN (
             SELECT key FROM cache_entries ORDER BY updated_at ASC LIMIT ?
           )`,
        )
        .run(excess);
    }
  }
}
