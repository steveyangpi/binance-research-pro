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
```

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

## Security and operations

- Local paths must be under an allowlisted root; checks resolve symlinks and Windows junctions.
- URLs require HTTPS and no credentials. Every redirect is revalidated and each HTTPS connection is bound to its validated public address.
- Downloads, source files, and streamed ZIP extraction are bounded by `WAREHOUSE_MAX_IMPORT_BYTES`.
- Imports are serialized in one process. Do not run multiple writers against one metadata database.
- Moving or deleting Parquet does not mutate metadata automatically; queries skip missing files, so manage the directory and database together.
- `generic-csv` uses automatic type inference. Add an explicit, tested profile later for any long-lived stable dataset.
