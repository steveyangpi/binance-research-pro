import AdmZip from 'adm-zip';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { WarehouseMetadataStore } from '../src/warehouse/metadata-store.js';
import { WarehouseService } from '../src/warehouse/warehouse-service.js';

const temporaryDirectories: string[] = [];
const services: WarehouseService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createWarehouse(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'binance-mcp-warehouse-'));
  temporaryDirectories.push(directory);
  const importRoot = join(directory, 'imports');
  mkdirSync(importRoot);
  const config = loadConfig({
    WAREHOUSE_PARQUET_ROOT: join(directory, 'parquet'),
    WAREHOUSE_METADATA_DB_PATH: join(directory, 'metadata.sqlite'),
    WAREHOUSE_TEMP_DIR: join(directory, 'tmp'),
    WAREHOUSE_IMPORT_ROOTS: importRoot,
    ...overrides,
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
    expect(rows[0]).toMatchObject({
      symbol: 'BTCUSDT',
      interval: '1h',
      close: 42800,
      open_time: '2024-01-01 01:00:00',
    });

    const offsetRows = await service.queryCandles({
      dataset: 'candles',
      source: 'fixture',
      market: 'spot',
      symbol: 'BTCUSDT',
      interval: '1h',
      startTime: '2024-01-01T05:30:00+05:00',
      limit: 10,
    });
    expect(offsetRows).toHaveLength(1);
    expect(offsetRows[0]).toMatchObject({ open_time: '2024-01-01 01:00:00' });

    expect(
      await service.candleDataRange({
        dataset: 'candles',
        source: 'fixture',
        market: 'spot',
        symbol: 'BTCUSDT',
        interval: '1h',
      }),
    ).toMatchObject({
      rowCount: 2,
      minOpenTime: '2024-01-01 00:00:00',
      maxOpenTime: '2024-01-01 01:00:00',
    });
  });

  it('imports a ZIP entry without buffering its contents', async () => {
    const { importRoot, service } = createWarehouse();
    const inputPath = join(importRoot, 'BTCUSDT-1h.zip');
    const archive = new AdmZip();
    archive.addFile(
      'BTCUSDT-1h.csv',
      Buffer.from(
        '1704067200000,42000,42500,41900,42400,100,1704070799999,4220000,50,55,2320000,0\n',
      ),
    );
    archive.writeZip(inputPath);

    const result = await service.importFile({
      path: inputPath,
      dataset: 'candles',
      source: 'fixture',
      profile: 'binance-kline',
      market: 'spot',
      symbol: 'BTCUSDT',
      interval: '1h',
    });

    expect(result.rowCount).toBe(1);
    expect(result.files).toHaveLength(1);
  });

  it('rejects a ZIP entry that exceeds the configured extraction limit', async () => {
    const { importRoot, service } = createWarehouse({ WAREHOUSE_MAX_IMPORT_BYTES: '150' });
    const inputPath = join(importRoot, 'oversized.zip');
    const archive = new AdmZip();
    archive.addFile('large.csv', Buffer.alloc(200, 'a'));
    archive.writeZip(inputPath);

    await expect(
      service.importFile({
        path: inputPath,
        dataset: 'candles',
        source: 'fixture',
        profile: 'generic-csv',
      }),
    ).rejects.toThrow('Uncompressed ZIP entry exceeds WAREHOUSE_MAX_IMPORT_BYTES.');
  });

  it('returns a stable empty candle range shape', async () => {
    const { service } = createWarehouse();

    await expect(
      service.candleDataRange({
        dataset: 'candles',
        source: 'fixture',
        market: 'spot',
        symbol: 'BTCUSDT',
        interval: '1h',
      }),
    ).resolves.toEqual({
      dataset: 'candles',
      source: 'fixture',
      market: 'spot',
      symbol: 'BTCUSDT',
      interval: '1h',
      rowCount: 0,
      minOpenTime: null,
      maxOpenTime: null,
    });
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

  it('scopes candle coverage to the requested interval', async () => {
    const { importRoot, service } = createWarehouse();
    const request = {
      dataset: 'candles',
      source: 'fixture',
      profile: 'binance-kline' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };
    const kline = (openTime: number) =>
      [openTime, '42000,42500,41900,42400,100', openTime + 3599999, '4220000,50,55,2320000,0'].join(
        ',',
      );
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'one-a.csv', kline(1704067200000)),
      interval: '1h',
    });
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'one-c.csv', kline(1704240000000)),
      interval: '1h',
    });
    // Only the 1m series has 2024-01-02, so a 1h report that ignored interval would
    // borrow that day and hide the gap.
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'one-b.csv', kline(1704153600000)),
      interval: '1m',
    });

    const hourly = service.coverage({ ...request, interval: '1h' });
    expect(hourly.coveredDays).toEqual(['2024-01-01', '2024-01-03']);
    expect(hourly.coveredDayCount).toBe(2);
    expect(hourly.missingDays).toContain('2024-01-02');
    expect(hourly.firstDay).toBe('2024-01-01');
    expect(hourly.lastDay).toBe('2024-01-03');

    const minute = service.coverage({ ...request, interval: '1m' });
    expect(minute.coveredDays).toEqual(['2024-01-02']);
    expect(minute.firstDay).toBe('2024-01-02');
    expect(minute.lastDay).toBe('2024-01-02');
  });
});

// Fixtures mirror the real files: Spot has no header row, USD-M has one, and the two
// markets use different column names. Spot rows carry fractional microseconds so the
// file-level time pruning is exercised where a whole-second bound is not enough.
const SPOT_TRADES_CSV = [
  '6659866981,80341.83,0.00063,50.6153529,1788739200109781,False,True',
  '6659866982,80342.50,0.00200,160.6850000,1788739260602000,True,False',
].join('\n');
// Same trade IDs as Spot on purpose: the two markets number trades independently.
const UM_TRADES_CSV = [
  'id,price,qty,quote_qty,time,is_buyer_maker',
  '6659866981,80350.00,0.00063,50.62050,1788739200000,false',
  '6659866982,80351.11,0.00200,160.70222,1788739260600,true',
].join('\n');
const SPOT_AGG_TRADES_CSV =
  '4056677592,80341.83,0.007,6659866981,6659866992,1788739200109781,False,True';
const UM_AGG_TRADES_CSV = [
  'agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker',
  '4056677592,80341.83,0.007,1,12,1788739200000,false',
].join('\n');

type Row = Record<string, unknown>;

function writeFixture(importRoot: string, name: string, contents: string): string {
  const path = join(importRoot, name);
  writeFileSync(path, `${contents}\n`);
  return path;
}

describe('WarehouseService tape datasets', () => {
  it('imports Spot trades without a header, normalizing microseconds and booleans', async () => {
    const { importRoot, service } = createWarehouse();
    const path = writeFixture(importRoot, 'BTCUSDT-trades.csv', SPOT_TRADES_CSV);

    const result = await service.importFile({
      path,
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades',
      market: 'spot',
      symbol: 'btcusdt',
    });

    expect(result.rowCount).toBe(2);
    expect(result.files[0]).toMatchObject({
      year: 2026,
      month: 9,
      minEventTime: '2026-09-07 00:00:00.109781',
      maxEventTime: '2026-09-07 00:01:00.602',
    });

    const rows = (await service.queryTrades({
      dataset: 'trades',
      source: 'fixture',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      trade_id: '6659866982',
      price: 80342.5,
      qty: 0.002,
      quote_qty: 160.685,
      event_time: '2026-09-07 00:01:00.602',
      is_buyer_maker: true,
      is_best_match: false,
      dataset: 'trades',
      source: 'fixture',
      market: 'spot',
      symbol: 'BTCUSDT',
    });
    expect(rows[1]).toMatchObject({
      trade_id: '6659866981',
      event_time: '2026-09-07 00:00:00.109781',
      is_buyer_maker: false,
      is_best_match: true,
    });
  });

  it('imports USD-M trades with a header row that never becomes data', async () => {
    const { importRoot, service } = createWarehouse();
    const path = writeFixture(importRoot, 'BTCUSDT-um-trades.csv', UM_TRADES_CSV);

    const result = await service.importFile({
      path,
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades',
      market: 'um',
      symbol: 'BTCUSDT',
    });

    expect(result.rowCount).toBe(2);
    const rows = (await service.queryTrades({
      dataset: 'trades',
      market: 'um',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];

    expect(rows[0]).toMatchObject({
      trade_id: '6659866982',
      event_time: '2026-09-07 00:01:00.6',
      is_buyer_maker: true,
      is_best_match: null,
    });
  });

  it('imports aggregate trades with each market column layout', async () => {
    const { importRoot, service } = createWarehouse();
    const spotPath = writeFixture(importRoot, 'spot-agg.csv', SPOT_AGG_TRADES_CSV);
    const umPath = writeFixture(importRoot, 'um-agg.csv', UM_AGG_TRADES_CSV);

    await service.importFile({
      path: spotPath,
      dataset: 'aggtrades',
      source: 'fixture',
      profile: 'binance-agg-trades',
      market: 'spot',
      symbol: 'BTCUSDT',
    });
    await service.importFile({
      path: umPath,
      dataset: 'aggtrades',
      source: 'fixture',
      profile: 'binance-agg-trades',
      market: 'um',
      symbol: 'BTCUSDT',
    });

    const spot = (await service.queryTrades({
      dataset: 'aggtrades',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];
    expect(spot[0]).toMatchObject({
      agg_trade_id: '4056677592',
      first_trade_id: '6659866981',
      last_trade_id: '6659866992',
      qty: 0.007,
      // Binance publishes no quote quantity for aggregate trades.
      quote_qty: null,
      is_best_match: true,
    });

    const um = (await service.queryTrades({
      dataset: 'aggtrades',
      market: 'um',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];
    // `quantity` and `transact_time` map onto the shared qty and event_time names.
    expect(um[0]).toMatchObject({
      agg_trade_id: '4056677592',
      qty: 0.007,
      event_time: '2026-09-07 00:00:00',
      is_best_match: null,
    });
  });

  it('keeps Spot and USD-M trades that share a trade id separate', async () => {
    const { importRoot, service } = createWarehouse();
    const spotPath = writeFixture(importRoot, 'spot.csv', SPOT_TRADES_CSV);
    const umPath = writeFixture(importRoot, 'um.csv', UM_TRADES_CSV);

    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      symbol: 'BTCUSDT',
    };
    await service.importFile({ ...request, path: spotPath, market: 'spot' });
    await service.importFile({ ...request, path: umPath, market: 'um' });

    const spot = (await service.queryTrades({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];
    const um = (await service.queryTrades({
      dataset: 'trades',
      market: 'um',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];

    expect(spot.map((row) => row['trade_id'])).toEqual(['6659866982', '6659866981']);
    expect(um.map((row) => row['trade_id'])).toEqual(['6659866982', '6659866981']);
    expect(spot.every((row) => row['market'] === 'spot')).toBe(true);
    expect(um.every((row) => row['market'] === 'um')).toBe(true);
    // Same IDs, different prices: a merged result set would be visibly wrong.
    expect(spot[1]?.['price']).toBe(80341.83);
    expect(um[1]?.['price']).toBe(80350);
  });

  it('keeps the two markets apart in aggregation, not only at row level', async () => {
    const { importRoot, service } = createWarehouse();
    // A single shared file holding both markets is impossible through the import API, so
    // import each market and then assert the aggregates never merge them. The risk this
    // covers is a deduplication window that omits `market`: row-level output would still
    // look right while bucket totals silently dropped one market's rows.
    const request = {
      dataset: 'aggtrades',
      source: 'fixture',
      profile: 'binance-agg-trades' as const,
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'spot.csv', SPOT_AGG_TRADES_CSV),
      market: 'spot',
    });
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'um.csv', UM_AGG_TRADES_CSV),
      market: 'um',
    });

    for (const market of ['spot', 'um'] as const) {
      const range = await service.tapeDataRange({
        dataset: 'aggtrades',
        market,
        symbol: 'BTCUSDT',
      });
      const buckets = (await service.queryTrades({
        dataset: 'aggtrades',
        market,
        symbol: 'BTCUSDT',
        limit: 10,
        bucketSeconds: 86400,
      })) as Row[];
      const rangeRows = range.rowCount;
      // The bucket total must equal the range total: a market-blind dedup window would
      // collapse the two rows that share an id and quietly halve this.
      expect(Number(buckets[0]?.['trade_count']), `${market} bucket count`).toBe(rangeRows);
    }

    // Each market keeps exactly its own single row, not one of the two.
    const spot = await service.tapeDataRange({
      dataset: 'aggtrades',
      market: 'spot',
      symbol: 'BTCUSDT',
    });
    const um = await service.tapeDataRange({
      dataset: 'aggtrades',
      market: 'um',
      symbol: 'BTCUSDT',
    });
    expect(spot.rowCount).toBe(1);
    expect(um.rowCount).toBe(1);
  });

  it('rejects invalid tape import metadata', async () => {
    const { importRoot, service } = createWarehouse();
    const path = writeFixture(importRoot, 'spot.csv', SPOT_TRADES_CSV);
    const base = {
      path,
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };

    await expect(service.importFile({ ...base, dataset: 'aggtrades' })).rejects.toThrow(
      "binance-trades imports require dataset 'trades'.",
    );
    await expect(service.importFile({ ...base, interval: '1h' })).rejects.toThrow(
      'do not accept interval',
    );
    await expect(service.importFile({ ...base, hasHeader: true })).rejects.toThrow(
      'do not accept hasHeader',
    );
    await expect(service.importFile({ ...base, market: 'binance' })).rejects.toThrow(
      "require market 'spot' or 'um'",
    );
    await expect(service.importFile({ ...base, market: undefined })).rejects.toThrow(
      'require market and symbol',
    );
  });

  it('rejects a file whose column count does not match the labelled market', async () => {
    const { importRoot, service } = createWarehouse();
    const spotFile = writeFixture(importRoot, 'spot.csv', SPOT_TRADES_CSV);
    const umFile = writeFixture(importRoot, 'um.csv', UM_TRADES_CSV);
    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      symbol: 'BTCUSDT',
    };

    // 7-column Spot file read as USD-M, and the 6-column USD-M file read as Spot.
    await expect(
      service.importFile({ ...request, path: spotFile, market: 'um' }),
    ).rejects.toThrow();
    await expect(
      service.importFile({ ...request, path: umFile, market: 'spot' }),
    ).rejects.toThrow();
  });

  it('deduplicates a republished archive by market and trade id', async () => {
    const { importRoot, service } = createWarehouse();
    const first = writeFixture(importRoot, 'v1.csv', SPOT_TRADES_CSV);
    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };
    const firstResult = await service.importFile({ ...request, path: first });

    const revised = writeFixture(
      importRoot,
      'v2.csv',
      [
        '6659866981,80345.00,0.00063,50.6153529,1788739200109781,False,True',
        '6659866982,80342.50,0.00200,160.6850000,1788739260602000,True,False',
        '6659866983,80346.00,0.00100,80.3460000,1788739200900000,False,False',
      ].join('\n'),
    );
    const secondResult = await service.importFile({ ...request, path: revised });

    expect(secondResult.duplicate).toBe(false);
    expect(secondResult.importId).not.toBe(firstResult.importId);
    expect(await service.importFile({ ...request, path: revised })).toMatchObject({
      duplicate: true,
      importId: secondResult.importId,
    });

    const rows = (await service.queryTrades({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];

    expect(rows.map((row) => row['trade_id'])).toEqual(['6659866982', '6659866983', '6659866981']);
    expect(rows.find((row) => row['trade_id'] === '6659866981')).toMatchObject({
      price: 80345,
    });
  });

  it('applies time windows to tape queries, including offset-bearing bounds', async () => {
    const { importRoot, service } = createWarehouse();
    const path = writeFixture(importRoot, 'spot.csv', SPOT_TRADES_CSV);
    await service.importFile({
      path,
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades',
      market: 'spot',
      symbol: 'BTCUSDT',
    });

    const utc = (await service.queryTrades({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      startTime: '2026-09-07T00:00:30Z',
      limit: 10,
    })) as Row[];
    expect(utc).toHaveLength(1);
    expect(utc[0]).toMatchObject({ trade_id: '6659866982' });

    // 08:00:30+08:00 is the same instant; a naive string comparison would drop rows.
    const offset = await service.queryTrades({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      startTime: '2026-09-07T08:00:30+08:00',
      limit: 10,
    });
    expect(offset).toEqual(utc);
  });

  it('aggregates tape queries into buckets after deduplication', async () => {
    const { importRoot, service } = createWarehouse();
    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'v1.csv', SPOT_TRADES_CSV),
    });
    await service.importFile({
      ...request,
      path: writeFixture(
        importRoot,
        'v2.csv',
        [
          '6659866981,80345.00,0.00063,50.6153529,1788739200109781,False,True',
          '6659866982,80342.50,0.00200,160.6850000,1788739260602000,True,False',
          '6659866983,80346.00,0.00100,80.3460000,1788739200900000,False,False',
        ].join('\n'),
      ),
    });

    const buckets = (await service.queryTrades({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      bucketSeconds: 3600,
      limit: 10,
    })) as Row[];

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ bucket_start: '2026-09-07 00:00:00' });
    // 3 distinct trades, not 5 source rows: deduplication runs before aggregation.
    expect(Number(buckets[0]?.['trade_count'])).toBe(3);
    expect(buckets[0]?.['volume']).toBeCloseTo(0.00363, 12);
    expect(buckets[0]?.['quote_volume']).toBeCloseTo(291.64835, 8);
    expect(buckets[0]?.['vwap']).toBeCloseTo(291.64835 / 0.00363, 6);
    expect(buckets[0]?.['taker_buy_volume']).toBeCloseTo(0.00163, 12);
    expect(buckets[0]?.['taker_sell_volume']).toBeCloseTo(0.002, 12);
    expect(buckets[0]?.['open']).toBe(80345);
    expect(buckets[0]?.['close']).toBe(80342.5);

    // Without bucketSeconds the same call returns raw rows.
    const rows = await service.queryTrades({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
    });
    expect(rows).toHaveLength(3);
  });

  it('rejects a bucket query that would exceed its bucket limit', async () => {
    const { importRoot, service } = createWarehouse();
    await service.importFile({
      path: writeFixture(importRoot, 'spot.csv', SPOT_TRADES_CSV),
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades',
      market: 'spot',
      symbol: 'BTCUSDT',
    });

    await expect(
      service.queryTrades({
        dataset: 'trades',
        market: 'spot',
        symbol: 'BTCUSDT',
        bucketSeconds: 60,
        limit: 1,
      }),
    ).rejects.toThrow('matched more than 1 buckets');
  });

  it('reports tape ranges and prunes files by their stored time bounds', async () => {
    const { directory, importRoot, service } = createWarehouse();
    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'sep.csv', SPOT_TRADES_CSV),
    });
    await service.importFile({
      ...request,
      path: writeFixture(
        importRoot,
        'oct.csv',
        '7000000001,90000.00,0.00100,90.0000000,1790812800000000,False,True',
      ),
    });

    await expect(
      service.tapeDataRange({
        dataset: 'trades',
        source: 'fixture',
        symbol: 'BTCUSDT',
        market: 'spot',
      }),
    ).resolves.toMatchObject({
      dataset: 'trades',
      source: 'fixture',
      market: 'spot',
      symbol: 'BTCUSDT',
      rowCount: 3,
      minEventTime: '2026-09-07 00:00:00.109781',
      maxEventTime: '2026-10-01 00:00:00',
    });

    const store = new WarehouseMetadataStore(join(directory, 'metadata.sqlite'));
    try {
      const selection = { dataset: 'trades', market: 'spot', symbol: 'BTCUSDT' };
      expect(store.seriesFiles('binance-trades', selection, {})).toHaveLength(2);
      // The October file cannot overlap a September window.
      expect(
        store.seriesFiles('binance-trades', selection, {
          startTime: '2026-09-07T00:00:00Z',
          endTime: '2026-09-07T23:59:59Z',
        }),
      ).toHaveLength(1);
      // A whole-second bound must still match files whose bounds carry microseconds.
      expect(
        store.seriesFiles('binance-trades', selection, { endTime: '2026-09-07T00:00:00Z' }),
      ).toHaveLength(1);
    } finally {
      store.close();
    }

    // A windowed range must read only the files that overlap it. Without this, the range
    // tool is the one path that grows with the age of the warehouse rather than with the
    // query: unbounded it scans every file the symbol has ever produced.
    await expect(
      service.tapeDataRange(
        { dataset: 'trades', source: 'fixture', symbol: 'BTCUSDT', market: 'spot' },
        { startTime: '2026-09-07T00:00:00Z', endTime: '2026-09-07T23:59:59Z' },
      ),
    ).resolves.toMatchObject({
      rowCount: 2,
      minEventTime: '2026-09-07 00:00:00.109781',
      maxEventTime: '2026-09-07 00:01:00.602',
    });
  });

  it('rejects unknown tape datasets and markets at query time', async () => {
    const { service } = createWarehouse();

    await expect(
      service.queryTrades({ dataset: 'candles', market: 'spot', symbol: 'BTCUSDT', limit: 1 }),
    ).rejects.toThrow("dataset must be 'trades' or 'aggtrades'.");
    await expect(
      service.queryTrades({ dataset: 'trades', market: 'binance', symbol: 'BTCUSDT', limit: 1 }),
    ).rejects.toThrow("market must be 'spot' or 'um'.");
  });

  it('reports missing days that a min/max dataset summary hides', async () => {
    const { importRoot, service } = createWarehouse();
    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'sep.csv', SPOT_TRADES_CSV),
    });
    await service.importFile({
      ...request,
      path: writeFixture(
        importRoot,
        'oct.csv',
        '7000000001,90000.00,0.00100,90.0000000,1790812800000000,False,True',
      ),
    });

    // The dataset summary collapses these two files to one min/max pair spanning
    // 2026-09-07 to 2026-10-01, which reads as continuous coverage.
    const summary = service.listDatasets() as Row[];
    expect(summary[0]).toMatchObject({ min_event_time: '2026-09-07 00:00:00.109781' });

    // Coverage is what exposes that the 24 days in between were never imported.
    const coverage = service.coverage({ dataset: 'trades', source: 'fixture', market: 'spot' });
    expect(coverage.coveredDayCount).toBe(2);
    expect(coverage.firstDay).toBe('2026-09-07');
    expect(coverage.lastDay).toBe('2026-10-01');
    expect(coverage.missingDayCount).toBe(23);
    expect(coverage.coveredDays as string[]).toEqual(['2026-09-07', '2026-10-01']);
    expect(coverage.missingDays as string[]).toContain('2026-09-15');
    expect(coverage.missingDays as string[]).not.toContain('2026-09-07');
  });

  it('limits the coverage report to a requested window and honours market isolation', async () => {
    const { importRoot, service } = createWarehouse();
    const request = {
      dataset: 'aggtrades',
      source: 'fixture',
      profile: 'binance-agg-trades' as const,
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'spot.csv', SPOT_AGG_TRADES_CSV),
      market: 'spot',
    });
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'um.csv', UM_AGG_TRADES_CSV),
      market: 'um',
    });

    // A window that brackets the single imported day must report that day as covered and
    // its neighbours as missing, rather than reporting an empty or unfiltered result.
    const spot = service.coverage(
      { dataset: 'aggtrades', source: 'fixture', market: 'spot' },
      { startTime: '2026-09-06T00:00:00Z', endTime: '2026-09-08T00:00:00Z' },
    );
    expect(spot.coveredDays).toEqual(['2026-09-07']);
    expect(spot.expectedDayCount).toBe(3);
    expect(spot.missingDays).toEqual(['2026-09-06', '2026-09-08']);

    // The um import is a separate file set, so it must not borrow spot's coverage.
    const um = service.coverage({ dataset: 'aggtrades', source: 'fixture', market: 'um' });
    expect(um.coveredDayCount).toBe(1);
    expect(um.missingDayCount).toBe(0);
  });

  it('filters listed files by market', async () => {
    const { importRoot, service } = createWarehouse();
    const request = {
      dataset: 'trades',
      source: 'fixture',
      profile: 'binance-trades' as const,
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'spot.csv', SPOT_TRADES_CSV),
      market: 'spot',
    });
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'um.csv', UM_TRADES_CSV),
      market: 'um',
    });

    const spotOnly = service.listFiles({
      dataset: 'trades',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
    });
    const umOnly = service.listFiles({
      dataset: 'trades',
      market: 'um',
      symbol: 'BTCUSDT',
      limit: 10,
    });
    expect(spotOnly).toHaveLength(1);
    expect(umOnly).toHaveLength(1);
    expect(spotOnly[0]).toMatchObject({ market: 'spot' });
    expect(umOnly[0]).toMatchObject({ market: 'um' });
  });
});

const METRICS_CSV = [
  'create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,' +
    'sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio',
  '2026-08-01 00:00:00,BTCUSDT,109489.826,6890085260.354,2.36265734,1.611983,2.20090658,1.791775',
  '2026-08-01 00:05:00,BTCUSDT,109479.913,6889214072.139754,2.36213405,1.612411,2.20111254,0.858165',
].join('\n');
const BOOK_DEPTH_CSV = [
  'timestamp,percentage,depth,notional',
  '2026-08-01 00:00:01,-0.20,103.5,6500000.0',
  '2026-08-01 00:00:01,0.20,98.2,6200000.0',
  '2026-08-01 00:00:31,-0.20,101.0,6400000.0',
  '2026-08-01 00:00:31,0.20,97.0,6100000.0',
].join('\n');

describe('WarehouseService order flow and series', () => {
  async function importTapeFixture(service: WarehouseService, importRoot: string) {
    const request = {
      dataset: 'aggtrades',
      source: 'fixture',
      profile: 'binance-agg-trades' as const,
      market: 'spot',
      symbol: 'BTCUSDT',
    };
    await service.importFile({
      ...request,
      path: writeFixture(importRoot, 'spot-agg.csv', SPOT_AGG_TRADES_CSV),
    });
    // A second, larger aggregate trade on the same day, so thresholds have something to bite on.
    await service.importFile({
      ...request,
      path: writeFixture(
        importRoot,
        'spot-agg-large.csv',
        '7000000001,80350.00,2.500,6659866990,6659866999,1788739260000000,True,True',
      ),
    });
    return request;
  }

  it('filters large orders by notional using price times quantity', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);
    const selection = { ...request, limit: 10 };

    const all = (await service.queryTrades(selection)) as Row[];
    expect(all).toHaveLength(2);

    // Quantities are 0.007 (~562) and 2.5 (~200875), so 100000 isolates the large one.
    const large = (await service.queryTrades({ ...selection, minNotional: 100000 })) as Row[];
    expect(large).toHaveLength(1);
    expect(large[0]).toMatchObject({ agg_trade_id: '7000000001', qty: 2.5 });

    const none = await service.queryTrades({ ...selection, minNotional: 10_000_000 });
    expect(none).toHaveLength(0);
  });

  it('reports positive and default large-order columns when bucketing', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);
    const selection = { ...request, bucketSeconds: 86400, limit: 10 };

    const plain = (await service.queryTrades(selection)) as Row[];
    expect(plain).toHaveLength(1);
    // With no threshold the large-order columns mirror the bucket totals.
    expect(Number(plain[0]?.['large_trade_count'])).toBe(2);
    expect(plain[0]?.['large_trade_notional']).toBeCloseTo(plain[0]?.['quote_volume'] as number, 6);

    const thresholded = (await service.queryTrades({
      ...selection,
      minNotional: 100000,
    })) as Row[];
    expect(Number(thresholded[0]?.['large_trade_count'])).toBe(1);
    expect(thresholded[0]?.['large_trade_notional']).toBeCloseTo(2.5 * 80350, 2);
    // The bucket totals are unaffected by the threshold.
    expect(Number(thresholded[0]?.['trade_count'])).toBe(2);
  });

  it('exposes span for aggregate trades and rejects minSpan for raw trades', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);

    const rows = (await service.queryTrades({ ...request, limit: 10 })) as Row[];
    const small = rows.find((row) => row['agg_trade_id'] === '4056677592');
    // first 6659866981 .. last 6659866992 consumes twelve resting orders.
    expect(small?.['span']).toBe('12');

    const swept = (await service.queryTrades({ ...request, limit: 10, minSpan: 11 })) as Row[];
    expect(swept).toHaveLength(1);
    expect(swept[0]?.['agg_trade_id']).toBe('4056677592');

    // Raw trades store one fill per row, so span has no meaning there.
    await expect(
      service.queryTrades({ ...request, dataset: 'trades', limit: 10, minSpan: 2 }),
    ).rejects.toThrow('minSpan is only available for the aggtrades dataset.');
    // Sweep filtering would redefine the bucket totals, so it is rejected, not ignored.
    await expect(
      service.queryTrades({ ...request, limit: 10, bucketSeconds: 3600, minSpan: 2 }),
    ).rejects.toThrow('minSpan applies to row-level queries only.');
  });

  it('aggregates per price level and requires buckets to do it', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);

    await expect(service.queryTrades({ ...request, limit: 10, groupBy: 'price' })).rejects.toThrow(
      'groupBy=price requires bucketSeconds',
    );

    // The price-level view reports whole-population counts, so a notional filter that
    // would redefine them is rejected rather than silently applied.
    await expect(
      service.queryTrades({
        ...request,
        limit: 10,
        bucketSeconds: 86400,
        groupBy: 'price',
        minNotional: 1,
      }),
    ).rejects.toThrow('minNotional applies to row-level and bucketed queries');

    // An unbounded frame would read the symbol's whole history before the row cap bites.
    await expect(
      service.queryTrades({ ...request, limit: 10, bucketSeconds: 86400, groupBy: 'price' }),
    ).rejects.toThrow('requires both startTime and endTime');

    const rows = (await service.queryTrades({
      ...request,
      limit: 10,
      bucketSeconds: 86400,
      groupBy: 'price',
      startTime: '2026-09-07T00:00:00Z',
      endTime: '2026-09-07T23:59:59Z',
    })) as Row[];

    // One row per level, not one per level and side: buy and sell are pivoted into
    // columns, and the level with the larger volume sorts first.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      price: 80350,
      taker_buy_volume: 0,
      taker_sell_volume: 2.5,
      delta: -2.5,
      volume: 2.5,
      trade_count: '1',
      bucket_start: '2026-09-07 00:00:00',
    });
    expect(rows[1]).toMatchObject({
      price: 80341.83,
      taker_buy_volume: 0.007,
      taker_sell_volume: 0,
      delta: 0.007,
      volume: 0.007,
    });
    expect(rows[0]?.['first_event_time']).toBe(rows[0]?.['last_event_time']);
  });

  it('accumulates CVD across buckets and reports the per-bucket delta', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);

    const buckets = (await service.queryTrades({
      ...request,
      limit: 10,
      bucketSeconds: 60,
    })) as Row[];

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ bucket_start: '2026-09-07 00:00:00' });
    expect(Number(buckets[0]?.['taker_delta'])).toBeCloseTo(0.007, 9);
    expect(Number(buckets[0]?.['cvd'])).toBeCloseTo(0.007, 9);
    expect(Number(buckets[1]?.['taker_delta'])).toBeCloseTo(-2.5, 9);
    // CVD is the running total, not a repeat of the bucket delta.
    expect(Number(buckets[1]?.['cvd'])).toBeCloseTo(-2.493, 9);
  });

  it('re-anchors CVD to the requested window rather than to an absolute origin', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);

    const full = (await service.queryTrades({
      ...request,
      limit: 10,
      startTime: '2026-09-07T00:00:00Z',
      endTime: '2026-09-07T00:02:00Z',
      bucketSeconds: 60,
    })) as Row[];
    // Drop the first bucket: the remaining bucket must restart its own CVD at its own delta.
    const trimmed = (await service.queryTrades({
      ...request,
      limit: 10,
      startTime: '2026-09-07T00:01:00Z',
      endTime: '2026-09-07T00:02:00Z',
      bucketSeconds: 60,
    })) as Row[];

    expect(full).toHaveLength(2);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]?.['bucket_start']).toBe(full[1]?.['bucket_start']);
    // Same bucket, same trades — but CVD equals the delta rather than the window total.
    expect(Number(trimmed[0]?.['cvd'])).toBeCloseTo(Number(trimmed[0]?.['taker_delta']), 9);
    expect(Number(full[1]?.['cvd'])).toBeCloseTo(-2.493, 9);
    // If CVD were anchored to an absolute origin, the trimmed value would be -2.493.
    expect(Number(trimmed[0]?.['cvd'])).not.toBeCloseTo(-2.493, 3);
  });

  it('scopes a query to a price band in every mode', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);
    // The fixture holds 80341.83 (qty 0.007) and 80350 (qty 2.5).

    const upper = (await service.queryTrades({ ...request, limit: 10, minPrice: 80345 })) as Row[];
    expect(upper).toHaveLength(1);
    expect(upper[0]).toMatchObject({ price: 80350, qty: 2.5 });

    const lower = (await service.queryTrades({ ...request, limit: 10, maxPrice: 80345 })) as Row[];
    expect(lower).toHaveLength(1);
    expect(lower[0]).toMatchObject({ price: 80341.83 });

    // A band is a scope, not a row filter bolted onto one mode: bucketed totals must
    // describe the band too, not the whole symbol.
    const scoped = (await service.queryTrades({
      ...request,
      limit: 10,
      bucketSeconds: 3600,
      minPrice: 80345,
    })) as Row[];
    expect(scoped).toHaveLength(1);
    expect(Number(scoped[0]?.['trade_count'])).toBe(1);
    expect(scoped[0]?.['volume']).toBeCloseTo(2.5, 9);
    expect(scoped[0]?.['taker_delta']).toBeCloseTo(-2.5, 9);

    // The price-level view honours it as well.
    const levels = (await service.queryTrades({
      ...request,
      limit: 10,
      bucketSeconds: 3600,
      groupBy: 'price',
      minPrice: 80345,
      startTime: '2026-09-07T00:00:00Z',
      endTime: '2026-09-07T23:59:59Z',
    })) as Row[];
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ price: 80350 });
  });

  it('rejects a malformed price band', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);

    await expect(
      service.queryTrades({ ...request, limit: 10, minPrice: 90000, maxPrice: 80000 }),
    ).rejects.toThrow('minPrice must not exceed maxPrice.');
    await expect(service.queryTrades({ ...request, limit: 10, maxPrice: -1 })).rejects.toThrow(
      'maxPrice must be at least 0.',
    );
  });

  it('names the offending argument instead of failing in DuckDB', async () => {
    const { importRoot, service } = createWarehouse();
    const request = await importTapeFixture(service, importRoot);
    // A value past Number.MAX_SAFE_INTEGER is still finite, so Number.isFinite would accept
    // it and interpolate it. It then dies inside DuckDB with a cast error that names no
    // argument, which is worse than saying which one was wrong.
    const beyondSafe = Number.MAX_SAFE_INTEGER + 2;

    await expect(
      service.queryTrades({ ...request, limit: 10, minPrice: beyondSafe }),
    ).rejects.toThrow('minPrice must be a safe integer');
    await expect(
      service.queryTrades({ ...request, limit: 10, minNotional: beyondSafe }),
    ).rejects.toThrow('minNotional must be a safe integer');
    await expect(service.queryTrades({ ...request, limit: 10, minSpan: 1.5 })).rejects.toThrow(
      'minSpan must be an integer',
    );

    // Same treatment at the series boundary.
    await expect(
      service.querySeries({
        dataset: 'metrics',
        market: 'um',
        symbol: 'NOPE',
        percentage: Number.NaN,
      }),
    ).rejects.toThrow('percentage must be a finite number');
    await expect(
      service.querySeries({
        dataset: 'metrics',
        market: 'um',
        symbol: 'NOPE',
        percentage: -0.2,
      }),
    ).rejects.toThrow('percentage is only available for the bookdepth dataset');
    await expect(
      service.querySeries({
        dataset: 'bookdepth',
        market: 'um',
        symbol: 'NOPE',
        bucketSeconds: 2.5,
      }),
    ).rejects.toThrow('bucketSeconds must be a positive integer');
  });

  it('reports a null imbalance instead of failing when a bucket has no volume', async () => {
    const { importRoot, service } = createWarehouse();
    await service.importFile({
      path: writeFixture(
        importRoot,
        'zero.csv',
        '7000000009,80350.00,0,7000000008,7000000009,1788739200000000,False,True',
      ),
      dataset: 'aggtrades',
      source: 'fixture',
      profile: 'binance-agg-trades',
      market: 'spot',
      symbol: 'BTCUSDT',
    });

    const buckets = (await service.queryTrades({
      dataset: 'aggtrades',
      market: 'spot',
      symbol: 'BTCUSDT',
      limit: 10,
      bucketSeconds: 3600,
    })) as Row[];

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.['volume']).toBe(0);
    expect(buckets[0]?.['taker_delta']).toBe(0);
    expect(buckets[0]?.['taker_imbalance']).toBeNull();
  });

  it('imports and queries the futures metrics series', async () => {
    const { importRoot, service } = createWarehouse();
    const result = await service.importFile({
      path: writeFixture(importRoot, 'metrics.csv', METRICS_CSV),
      dataset: 'metrics',
      source: 'fixture',
      profile: 'binance-metrics',
      market: 'um',
      symbol: 'btcusdt',
    });

    expect(result.rowCount).toBe(2);
    expect(result.files[0]).toMatchObject({ year: 2026, month: 8 });

    const rows = (await service.querySeries({
      dataset: 'metrics',
      market: 'um',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event_time: '2026-08-01 00:05:00',
      sum_taker_long_short_vol_ratio: 0.858165,
      symbol: 'BTCUSDT',
      market: 'um',
    });

    const bucketed = (await service.querySeries({
      dataset: 'metrics',
      market: 'um',
      symbol: 'BTCUSDT',
      bucketSeconds: 3600,
      limit: 10,
    })) as Row[];
    expect(bucketed).toHaveLength(1);
    expect(bucketed[0]?.['sum_open_interest_avg']).toBeCloseTo((109489.826 + 109479.913) / 2, 3);
    expect(bucketed[0]?.['sum_open_interest_last']).toBeCloseTo(109479.913, 3);
    expect(bucketed[0]?.['sum_open_interest_min']).toBeCloseTo(109479.913, 3);
  });

  it('imports book depth, keeps the sign of the band and filters by it', async () => {
    const { importRoot, service } = createWarehouse();
    const result = await service.importFile({
      path: writeFixture(importRoot, 'bookdepth.csv', BOOK_DEPTH_CSV),
      dataset: 'bookdepth',
      source: 'fixture',
      profile: 'binance-book-depth',
      market: 'um',
      symbol: 'BTCUSDT',
    });
    expect(result.rowCount).toBe(4);

    const all = (await service.querySeries({
      dataset: 'bookdepth',
      market: 'um',
      symbol: 'BTCUSDT',
      limit: 10,
    })) as Row[];
    expect(all).toHaveLength(4);

    const bidSide = (await service.querySeries({
      dataset: 'bookdepth',
      market: 'um',
      symbol: 'BTCUSDT',
      percentage: -0.2,
      limit: 10,
    })) as Row[];
    expect(bidSide).toHaveLength(2);
    expect(bidSide.every((row) => row['percentage'] === -0.2)).toBe(true);

    // Bucket rows keep the band separate instead of averaging across bands.
    const bucketed = (await service.querySeries({
      dataset: 'bookdepth',
      market: 'um',
      symbol: 'BTCUSDT',
      bucketSeconds: 86400,
      limit: 10,
    })) as Row[];
    expect(bucketed).toHaveLength(2);
    expect(new Set(bucketed.map((row) => row['percentage']))).toEqual(new Set([-0.2, 0.2]));
  });

  it('rejects series metadata that does not match the published shape', async () => {
    const { importRoot, service } = createWarehouse();
    const path = writeFixture(importRoot, 'metrics.csv', METRICS_CSV);
    const base = {
      path,
      dataset: 'metrics',
      source: 'fixture',
      profile: 'binance-metrics' as const,
      market: 'um',
      symbol: 'BTCUSDT',
    };

    // Both series datasets exist for USD-M only.
    await expect(service.importFile({ ...base, market: 'spot' })).rejects.toThrow(
      "require market 'um'",
    );
    await expect(service.importFile({ ...base, dataset: 'bookdepth' })).rejects.toThrow(
      "require dataset 'metrics'",
    );
    await expect(service.importFile({ ...base, interval: '1h' })).rejects.toThrow(
      'do not accept interval',
    );

    await expect(
      service.querySeries({ dataset: 'metrics', market: 'spot', symbol: 'BTCUSDT', limit: 1 }),
    ).rejects.toThrow("market must be 'um'");
    // A band filter is meaningless for metrics.
    await expect(
      service.querySeries({
        dataset: 'metrics',
        market: 'um',
        symbol: 'BTCUSDT',
        percentage: -0.2,
        limit: 1,
      }),
    ).rejects.toThrow('percentage is only available for the bookdepth dataset.');
  });
});
