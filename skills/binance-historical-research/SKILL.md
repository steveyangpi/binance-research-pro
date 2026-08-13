---
name: binance-historical-research
description: Work with the local Binance DuckDB and Parquet history warehouse. Use to inspect datasets and files, check date coverage, query imported candlesticks, or import an explicitly approved local or HTTPS CSV, ZIP, or Parquet source. Use read tools by default and treat imports as state-changing operations.
---

# Binance Historical Research

The warehouse is separate from the short-lived public API cache. It stores durable Parquet data and SQLite import metadata.

## Read-first workflow

1. Call `warehouse_status` when configuration matters.
2. Call `warehouse_list_datasets` or `warehouse_data_range` before assuming data exists.
3. Use `warehouse_query_candles` with the narrowest symbol, interval, time range, and limit needed.
4. State dataset, source, market, symbol, interval, earliest/latest time, and row count when available.

## Imports

- Use `warehouse_import_file` only for a path inside `WAREHOUSE_IMPORT_ROOTS` that the user identified or approved.
- Use `warehouse_import_url` only for an HTTPS URL the user identified or approved. Prefer Binance official public-data URLs and provide SHA-256 when available.
- Imports write files and metadata. Explain the source, dataset, profile, market, symbol, and interval before calling one.
- Never invent a local path or weaken path restrictions.

## Data semantics

- `binance-kline` is the normalized 12-column Binance K-line profile.
- Spot archive timestamps from 2025 onward may use microseconds; the backend normalizes supported Binance archive formats.
- Query results are deduplicated by open time and returned newest first.
- Missing coverage is not zero activity. Report gaps explicitly.
