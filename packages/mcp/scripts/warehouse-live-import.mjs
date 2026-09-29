// Opt-in live check for the tape import pipeline (plan items L1/L2).
// Requires network access to data.binance.vision and api.binance.com, so it is NOT
// part of `npm run check`. Run it with `npm run test:warehouse:live`.
//
// It imports one official daily archive into a throwaway warehouse, then cross-checks
// bucketed aggregation against the official 1m Kline for the same window. The Kline
// comparison is what pins the taker direction, and the import itself is the only check
// that exercises the real HTTPS download path end to end.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../dist/config.js';
import { WarehouseService } from '../dist/warehouse/warehouse-service.js';

const SYMBOL = process.argv[2] ?? 'BTCUSDT';
const DAY = process.argv[3] ?? '2026-08-01';
const KLINE_URL = 'https://api.binance.com/api/v3/klines';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const root = mkdtempSync(join(tmpdir(), 'warehouse-live-'));
const service = new WarehouseService(
  loadConfig({
    WAREHOUSE_PARQUET_ROOT: join(root, 'parquet'),
    WAREHOUSE_METADATA_DB_PATH: join(root, 'metadata.sqlite'),
    WAREHOUSE_TEMP_DIR: join(root, 'tmp'),
    WAREHOUSE_IMPORT_ROOTS: join(root, 'imports'),
  }),
);

try {
  const url =
    `https://data.binance.vision/data/spot/daily/aggTrades/${SYMBOL}/` +
    `${SYMBOL}-aggTrades-${DAY}.zip`;
  const checksumResponse = await fetch(`${url}.CHECKSUM`);
  if (!checksumResponse.ok)
    throw new Error(`CHECKSUM download failed: HTTP ${checksumResponse.status}`);
  const expectedSha256 = (await checksumResponse.text()).trim().split(/\s+/)[0];

  const imported = await service.importUrl({
    url,
    dataset: 'aggtrades',
    source: 'binance-public-data',
    profile: 'binance-agg-trades',
    market: 'spot',
    symbol: SYMBOL,
    expectedSha256,
  });
  console.log(`imported ${imported.rowCount} rows from ${url}`);
  if (imported.rowCount === 0) fail('import reported no rows');

  const repeated = await service.importUrl({
    url,
    dataset: 'aggtrades',
    source: 'binance-public-data',
    profile: 'binance-agg-trades',
    market: 'spot',
    symbol: SYMBOL,
    expectedSha256,
  });
  console.log(`re-import duplicate flag: ${repeated.duplicate}`);
  if (repeated.duplicate !== true) fail('re-importing the same file must be idempotent');

  const range = await service.tapeDataRange({
    dataset: 'aggtrades',
    market: 'spot',
    symbol: SYMBOL,
  });
  console.log(`range: ${range.minEventTime} .. ${range.maxEventTime}`);
  if (range.minEventTime?.slice(0, 10) !== DAY)
    fail(`range starts on ${range.minEventTime}, expected ${DAY}`);

  const buckets = await service.queryTrades({
    dataset: 'aggtrades',
    market: 'spot',
    symbol: SYMBOL,
    startTime: `${DAY}T00:00:00Z`,
    endTime: `${DAY}T00:05:00Z`,
    bucketSeconds: 60,
    limit: 10,
  });

  const openTime = Date.parse(`${DAY}T00:00:00Z`);
  const klines = await (
    await fetch(
      `${KLINE_URL}?symbol=${SYMBOL}&interval=1m&limit=5&startTime=${openTime}` +
        `&endTime=${openTime + 5 * 60_000}`,
    )
  ).json();
  if (!Array.isArray(klines) || klines.length === 0)
    throw new Error('Kline cross-check returned no data');

  for (const [index, kline] of klines.entries()) {
    const bucket = buckets[index];
    const volume = Number(kline[5]);
    const takerBuy = Number(kline[9]);
    // Compare at 8 decimals: the two sources round differently beyond that.
    const volumeMatches = Math.abs(bucket?.volume - volume) < 1e-8;
    const takerMatches = Math.abs(bucket?.taker_buy_volume - takerBuy) < 1e-8;
    console.log(
      `minute ${index}: volume ${bucket?.volume} vs ${volume} (${volumeMatches ? 'ok' : 'MISMATCH'}), ` +
        `takerBuy ${bucket?.taker_buy_volume} vs ${takerBuy} (${takerMatches ? 'ok' : 'MISMATCH'})`,
    );
    if (!volumeMatches) fail(`minute ${index} volume differs from the official Kline`);
    if (!takerMatches) fail(`minute ${index} taker buy volume differs from the official Kline`);
  }

  console.log('Warehouse tape live check passed.');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await service.close();
  rmSync(root, { recursive: true, force: true });
}
