import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCache } from '../src/cache/sqlite-cache.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SqliteCache', () => {
  it('reuses a cached response after the cache instance restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binance-mcp-cache-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'cache.sqlite');
    let loaderCalls = 0;

    const first = new SqliteCache(databasePath, 100);
    const firstValue = await first.getOrLoad('futures:ticker:KORUUSDT', 60_000, async () => {
      loaderCalls += 1;
      return { lastPrice: 16.84 };
    });
    first.close();

    const second = new SqliteCache(databasePath, 100);
    const secondValue = await second.getOrLoad('futures:ticker:KORUUSDT', 60_000, async () => {
      loaderCalls += 1;
      return { lastPrice: 99 };
    });
    second.close();

    expect(firstValue).toEqual({ lastPrice: 16.84 });
    expect(secondValue).toEqual(firstValue);
    expect(loaderCalls).toBe(1);
  });
});
