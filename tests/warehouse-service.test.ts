import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { WarehouseService } from '../src/warehouse/warehouse-service.js';

const temporaryDirectories: string[] = [];
const services: WarehouseService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createWarehouse() {
  const directory = mkdtempSync(join(tmpdir(), 'binance-mcp-warehouse-'));
  temporaryDirectories.push(directory);
  const importRoot = join(directory, 'imports');
  mkdirSync(importRoot);
  const config = loadConfig({
    WAREHOUSE_PARQUET_ROOT: join(directory, 'parquet'),
    WAREHOUSE_METADATA_DB_PATH: join(directory, 'metadata.sqlite'),
    WAREHOUSE_TEMP_DIR: join(directory, 'tmp'),
    WAREHOUSE_IMPORT_ROOTS: importRoot,
  });
  const service = new WarehouseService(config);
  services.push(service);
  return { directory, importRoot, service };
}

describe('WarehouseService', () => {
  it('imports Binance Klines, normalizes ms/us timestamps and suppresses duplicates', async () => {
    const { importRoot, service } = createWarehouse();
    const inputPath = join(importRoot, 'BTCUSDT-1h.csv');
    writeFileSync(
      inputPath,
      [
        '1704067200000,42000,42500,41900,42400,100,1704070799999,4220000,50,55,2320000,0',
        '1704070800000000,42400,43000,42300,42800,120,1704074399999000,5100000,60,65,2770000,0',
      ].join('\n'),
    );

    const request = {
      path: inputPath,
      dataset: 'candles',
      source: 'fixture',
      profile: 'binance-kline' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
      interval: '1h',
    };
    const first = await service.importFile(request);
    const second = await service.importFile(request);
    const rows = await service.queryCandles({
      dataset: 'candles',
      source: 'fixture',
      market: 'spot',
      symbol: 'BTCUSDT',
      interval: '1h',
      limit: 10,
    });

    expect(first.duplicate).toBe(false);
    expect(first.rowCount).toBe(2);
    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({ year: 2024, month: 1 });
    expect(second.duplicate).toBe(true);
    expect(second.importId).toBe(first.importId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ symbol: 'BTCUSDT', interval: '1h', close: 42800 });
  });

  it('imports a generic header CSV without a platform-specific adapter', async () => {
    const { importRoot, service } = createWarehouse();
    const inputPath = join(importRoot, 'sentiment.csv');
    writeFileSync(inputPath, 'event_time,symbol,score\n2026-01-01T00:00:00Z,BTCUSDT,0.75\n');

    const result = await service.importFile({
      path: inputPath,
      dataset: 'sentiment',
      source: 'research-export',
      profile: 'generic-csv',
      hasHeader: true,
    });

    expect(result.rowCount).toBe(1);
    expect(result.files[0]?.path).toMatch(/\.parquet$/);
    expect(service.listDatasets()).toHaveLength(1);
  });

  it('rejects local files outside configured import roots', async () => {
    const { directory, service } = createWarehouse();
    const inputPath = join(directory, 'outside.csv');
    writeFileSync(inputPath, 'a,b\n1,2\n');

    await expect(
      service.importFile({
        path: inputPath,
        dataset: 'raw',
        source: 'fixture',
        profile: 'generic-csv',
      }),
    ).rejects.toThrow('outside WAREHOUSE_IMPORT_ROOTS');
  });

  it('rejects non-HTTPS downloads before making a request', async () => {
    const { service } = createWarehouse();
    await expect(
      service.importUrl({
        url: 'http://example.com/data.csv',
        dataset: 'raw',
        source: 'example',
        profile: 'generic-csv',
      }),
    ).rejects.toThrow('Only HTTPS');
  });
});
