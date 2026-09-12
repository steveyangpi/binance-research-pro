---
name: binance-historical-research
description: Work with the local Binance DuckDB and Parquet history warehouse. Use to inspect datasets and files, check date coverage, query imported candlesticks or tick-level trades and aggregate trades, or import an explicitly approved local or HTTPS CSV, ZIP, or Parquet source. Use read tools by default and treat imports as state-changing operations.
---

# Binance Historical Research

The warehouse is separate from the short-lived public API cache. It stores durable Parquet data and SQLite import metadata.

## Read-first workflow

1. Call `warehouse_status` when configuration matters.
2. Call `warehouse_list_datasets` or `warehouse_data_range` before assuming data exists.
3. Use `warehouse_query_candles` with the narrowest symbol, interval, time range, and limit needed.
4. Use `warehouse_query_trades` with a market and either a narrow window or `bucketSeconds`.
5. Use `warehouse_query_series` for the USD-M `metrics` and `bookdepth` snapshot datasets.
6. State dataset, source, market, symbol, interval, earliest/latest time, and row count when available.

## Imports

- Use `warehouse_import_file` only for a path inside `WAREHOUSE_IMPORT_ROOTS` that the user identified or approved.
- Use `warehouse_import_url` only for an HTTPS URL the user identified or approved. Prefer Binance official public-data URLs and provide SHA-256 when available.
- Imports write files and metadata. Explain the source, dataset, profile, market, symbol, and interval before calling one.
- Never invent a local path or weaken path restrictions.
- For daily tape archives, do not import the current or previous UTC day. Binance may republish those files and a republished archive is merged, not replaced.

## Data semantics

- `binance-kline` is the normalized 12-column Binance K-line profile. `binance-trades` and `binance-agg-trades` are the tick-level profiles, with datasets `trades` and `aggtrades`.
- `binance-metrics` and `binance-book-depth` are USD-M snapshot series, with datasets `metrics` and `bookdepth`; Binance publishes no spot counterpart. Query them with `warehouse_query_series`. Book depth is cumulative depth inside percentage bands, not a per-level order book.
- Tape imports require a market and reject `interval` and `hasHeader`; the header row is derived from the market. Do not pass an interval for tape data.
- Spot archive timestamps from 2025 onward may use microseconds; the backend normalizes supported Binance archive formats.
- Kline results are deduplicated by open time and returned newest first. Tape results are deduplicated by market plus trade ID, because Spot and USD-M number trades independently.
- Quote quantity is absent for aggregate trades, so aggregate views of that dataset report it as null and derive quote volume and VWAP from price times quantity.
- Row-level tape queries are bounded to a few thousand rows, under a second of a busy market. Use `bucketSeconds` to aggregate volume, VWAP, and taker imbalance over a wider window, and treat the bucket count limit as a signal to narrow the range.
- Missing coverage is not zero activity. Report gaps explicitly.
