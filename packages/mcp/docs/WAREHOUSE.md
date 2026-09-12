# Local data warehouse guide

[简体中文](WAREHOUSE.zh-CN.md)

## Purpose and boundary

The warehouse imports files produced by different interfaces or sources into local Parquet and queries them with DuckDB. It is not a provider API framework. V1 intentionally does not implement complex column mappings, asset aliases, market calendars, price adjustments, or conflict resolution. Those can become additional import profiles without replacing the storage core.

SQLite stores import jobs and Parquet metadata only; it does not hold multi-year price rows. Historical rows live under a configurable Parquet root.

## Configuration

```dotenv
WAREHOUSE_ENABLED=true
WAREHOUSE_PARQUET_ROOT=H:\marketData\warehouse\parquet
WAREHOUSE_METADATA_DB_PATH=H:\marketData\warehouse\metadata.sqlite
WAREHOUSE_TEMP_DIR=H:\marketData\warehouse\tmp
WAREHOUSE_IMPORT_ROOTS=H:\marketData\imports
WAREHOUSE_MAX_IMPORT_BYTES=536870912
WAREHOUSE_DOWNLOAD_TIMEOUT_MS=120000
WAREHOUSE_DUCKDB_MEMORY_LIMIT=1GB
```

`WAREHOUSE_DUCKDB_MEMORY_LIMIT` is optional. When set, DuckDB spills to `WAREHOUSE_TEMP_DIR` beyond that limit instead of growing without bound, which keeps a head-of-book tape file from exhausting memory. The plugin forwards it through `.mcp.json`; a value that is not a size such as `512MB` or `2GiB` is rejected at startup.

Separate multiple Windows import roots with semicolons, such as `H:\MarketImports;D:\ResearchExports`. Configuration changes do not require rebuilding, but the MCP client task must be restarted so the server process receives the new environment.

Example layout:

```text
H:\marketData\warehouse\parquet\
  dataset=candles\
    source=binance-public-data\
      market=um\symbol=BTCUSDT\interval=1h\
        import=<uuid>\year=2025\month=1\data_0.parquet
```

Every successful import gets an immutable task directory. Reimporting the same file with the same metadata and parse options returns the previous task through SHA-256 deduplication.

## Import profiles

### `binance-kline`

The input must be Binance's headerless 12-column CSV ordering, or a ZIP containing that CSV:

```text
open_time,open,high,low,close,volume,close_time,quote_asset_volume,
trade_count,taker_buy_base_asset_volume,taker_buy_quote_asset_volume,ignore
```

`symbol` and `interval` are required; `market=spot|um|cm` is recommended. Timestamp magnitude selects milliseconds or microseconds automatically and values become timezone-free UTC DuckDB `TIMESTAMP` values. Output uses ZSTD and `year/month` partitions.

### `binance-trades` and `binance-agg-trades`

Binance batch tape archives from `data.binance.vision`, as ZIPs or the bare CSV:

| Dataset     | Profile              | Content                                 |
| ----------- | -------------------- | --------------------------------------- |
| `trades`    | `binance-trades`     | every individual trade                  |
| `aggtrades` | `binance-agg-trades` | trades merged by price, order, and time |

`market=spot|um` and `symbol` are required. `interval` and `hasHeader` are rejected: the header is derived from the market, because Spot archives have no header row and USD-M archives have one. Column names also differ per market (`tradeId`/`quoteQty` versus `id`/`quote_qty`, `qty` versus `quantity`, `time` versus `transact_time`). All four layouts map onto one schema.

- Timestamps: Spot files use microseconds from 2025-01-01 onward and milliseconds before that; USD-M files use milliseconds. Magnitude detection normalizes all of them to the same timezone-free UTC `TIMESTAMP` the Kline profile uses.
- `is_best_match` is NULL for USD-M, which does not publish it.
- **`quote_qty` is NULL for `aggtrades`.** Binance publishes no quote quantity for aggregate trades, so the column is left empty rather than filled with a derived value. Aggregated queries compute `quoteVolume` and `vwap` from `price * qty` instead.
- `interval` never appears in the path. The layout is `dataset=<trades|aggtrades>/source=<source>/market=<spot|um>/symbol=<SYMBOL>/import=<uuid>/year/month`.

Rows are deduplicated by `(market, trade_id)` or `(market, agg_trade_id)`. The market is part of the key because Spot and USD-M number trades independently: the same ID exists in both markets, so deduplicating by ID alone would silently drop half the rows.

Because the four layouts have different column counts (Spot trades 7, USD-M trades 6, Spot aggTrades 8, USD-M aggTrades 7), importing a file under the wrong `market` fails on the column count instead of storing wrong data.

### Querying tape data

`warehouse_query_trades` requires `market` and offers two shapes:

- **Row level** (default): up to `limit` deduplicated rows, newest first.
- **Aggregated**: set `bucketSeconds` to get one row per time bucket with `tradeCount`, `volume`, `quoteVolume`, `vwap`, `takerBuyVolume`, `takerSellVolume`, `takerImbalance`, and `open`/`high`/`low`/`close`. `limit` then bounds the number of buckets, and the call fails rather than truncating silently.

Row-level results cap at 5000 rows, a fraction of a second of a busy market. Use `bucketSeconds` for anything wider. `takerBuyVolume` counts rows where `is_buyer_maker` is false — the aggressor was the buyer.

Bucketed results also carry `taker_delta` (buy minus sell) and `cvd`, the running sum of that delta. **CVD is anchored to the start of the requested window**, not to a session or a day: the same bucket reports a different CVD under a different `startTime`, so it is never comparable across windows.

Three optional parameters serve order-flow review:

| Parameter       | Modes         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minNotional`   | rows, buckets | What counts as a large order, measured as `price * qty`. Row-level queries return only trades at or above it. Bucketed queries keep the whole population and instead fill `large_trade_count` / `large_trade_notional`; it deliberately does not filter there, because filtering would silently redefine `tradeCount`, `volume` and `vwap`. Defaults to 0.                                                       |
| `minSpan`       | rows only     | What counts as a sweep: the minimum number of resting orders one aggressor order consumed. `aggtrades` only — raw trades store one fill per row and have no span.                                                                                                                                                                                                                                                |
| `groupBy=price` | buckets only  | A footprint view: one row per price level with the taker buy/sell split, net `delta`, `volume`, `trade_count`, and the level's hit span. Requires `bucketSeconds` **and both `startTime` and `endTime`**; an unbounded frame reads the whole history before the row cap can reject it. Rejects `minNotional`, which would distort the level distribution, and orders by volume so liquid levels survive the cap. |

A filter that has no meaning in the requested mode is rejected rather than ignored, so a silent no-op cannot be mistaken for a working filter. Quote volume and VWAP in bucketed results are derived from `price * qty`, because aggregate trades carry no quote quantity.

### `binance-metrics` and `binance-book-depth`

Two USD-M snapshot series. Binance publishes no spot counterpart for either.

| Dataset     | Profile              | Cadence    | Content                                                                                                          |
| ----------- | -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `metrics`   | `binance-metrics`    | 5 minutes  | Open interest, open-interest value, top-trader and account long/short ratios, and a taker buy/sell volume ratio  |
| `bookdepth` | `binance-book-depth` | 30 seconds | Cumulative depth and notional inside signed percentage bands (−5, −4, −3, −2, −1, −0.2 and the positive mirrors) |

`market=um` and `symbol` are required. **`bookdepth` is not a per-level order book** — it answers "how much cumulative depth sits within ±X%", not "what is resting at the touch". Per-level best-bid/ask archives stopped in early 2024.

Query them with `warehouse_query_series`:

```text
Call warehouse_query_series with dataset=metrics, symbol=BTCUSDT,
startTime=2026-08-01T00:00:00Z, endTime=2026-08-01T06:00:00Z.
Call warehouse_query_series with dataset=bookdepth, symbol=BTCUSDT, percentage=-0.2,
bucketSeconds=300, limit=100.
```

Set `bucketSeconds` to average each value per bucket; book depth keeps its `percentage` band as a separate group key, so aggregation never averages across bands. `percentage` selects one band and is rejected for `metrics`. Both datasets are small: book depth is roughly 12 MB per symbol-month and metrics roughly 0.2 MB.

### `generic-csv`

The first row is a header by default; pass `hasHeader=false` otherwise. DuckDB infers source names and types, and the importer only appends `_warehouse_import_id` and `_warehouse_imported_at`. This is suitable for preserving exports from another platform. V1 does not coerce them into the Kline schema, so `warehouse_query_candles` will not query these files.

### `parquet`

Reads existing Parquet and copies it into the managed warehouse with audit columns. Business columns are preserved and it is not automatically classified as Kline data.

## MCP examples

Put a local file under `H:\marketData\imports`, then send:

```text
Call warehouse_import_file from binance-research-pro with:
path=H:\marketData\imports\BTCUSDT-1h-2025-01.zip
dataset=candles
source=binance-public-data
profile=binance-kline
market=spot
symbol=BTCUSDT
interval=1h
expectedSha256=<optional 64-character SHA-256>
```

An official HTTPS archive can be imported with:

```text
Call warehouse_import_url with url=<official ZIP URL>, dataset=candles,
source=binance-public-data, profile=binance-kline, market=um,
symbol=BTCUSDT, interval=1h.
```

Inspect and query:

```text
Call warehouse_status.
Call warehouse_list_datasets.
Call warehouse_data_range with dataset=candles, source=binance-public-data,
market=spot, symbol=BTCUSDT, interval=1h.
Call warehouse_query_candles with the same selection,
startTime=2025-01-01T00:00:00Z, endTime=2025-01-31T23:59:59Z, limit=500.
```

Rows are returned newest first. When imports overlap on `open_time`, the row from the latest import is kept.

Tape archives use the same tools with a different selection:

```text
Call warehouse_import_url with url=<official daily tape ZIP URL>,
dataset=aggtrades, source=binance-public-data, profile=binance-agg-trades,
market=spot, symbol=BTCUSDT, expectedSha256=<64-character SHA-256>.
Call warehouse_data_range with dataset=aggtrades, market=spot, symbol=BTCUSDT.
Call warehouse_query_trades with dataset=aggtrades, market=spot, symbol=BTCUSDT,
startTime=2026-08-01T00:00:00Z, endTime=2026-08-01T01:00:00Z,
bucketSeconds=60, limit=120.
```

Do not pass `interval` for tape imports. Do not import the current or previous UTC day: Binance may republish those files, and a republished archive is merged rather than replaced.

## Security and operations

- Local paths must be under an allowlisted root; checks resolve symlinks and Windows junctions.
- URLs require HTTPS and no credentials. Every redirect is revalidated and each HTTPS connection is bound to its validated public address.
- Downloads, source files, and streamed ZIP extraction are bounded by `WAREHOUSE_MAX_IMPORT_BYTES`.
- Imports are serialized in one process. Do not run multiple writers against one metadata database.
- Moving or deleting Parquet does not mutate metadata automatically; queries skip missing files, so manage the directory and database together.
- `generic-csv` uses automatic type inference. Add an explicit, tested profile later for any long-lived stable dataset.
