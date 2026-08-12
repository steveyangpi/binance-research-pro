# Environment variables and storage configuration

[简体中文](ENVIRONMENT.zh-CN.md)

## Current Codex Desktop configuration

The current `binance-analysis` MCP Server stores all runtime data under `H:\marketData`:

```text
H:\marketData\
  cache\
    binance-analysis-cache.sqlite       # short-lived live public API cache
  imports\                              # local files allowed for warehouse_import_file
  warehouse\
    metadata.sqlite                     # import jobs and Parquet metadata
    parquet\                            # historical columnar data
    tmp\                                # download and ZIP extraction scratch space
```

The MCP Server creates directories on its first start or import. Existing caches and warehouse files under `H:\Code\binance-analysis-mcp\data` are not moved automatically; they can remain as historical copies.

Codex passes variables through `[mcp_servers.binance-analysis.env]`. After a change, start a new Codex Desktop task or restart the client. An already running server does not reload its environment.

## Binance public data and cache

| Variable                           | Default                                | Current desktop value                               | Description                                                                   |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `BINANCE_REST_BASE_URL`            | `https://api.binance.com`              | default                                             | Spot public REST API base URL.                                                |
| `BINANCE_FUTURES_REST_BASE_URL`    | `https://fapi.binance.com`             | default                                             | USD-M Futures public REST API base URL.                                       |
| `BINANCE_REQUEST_TIMEOUT_MS`       | `10000`                                | `20000`                                             | Per-request Binance HTTP timeout in milliseconds; maximum 60000.              |
| `BINANCE_CACHE_TTL_MS`             | `15000`                                | `15000`                                             | TTL in milliseconds for tickers, mark prices, order books, and open interest. |
| `BINANCE_CANDLE_CACHE_TTL_MS`      | `60000`                                | `60000`                                             | Spot/Futures Kline cache TTL in milliseconds.                                 |
| `BINANCE_FUNDING_CACHE_TTL_MS`     | `600000`                               | `600000`                                            | Futures funding-history cache TTL in milliseconds.                            |
| `BINANCE_PERSISTENT_CACHE_ENABLED` | `true`                                 | `true`                                              | `true` uses SQLite; `false` uses process-memory cache only.                   |
| `BINANCE_CACHE_DB_PATH`            | `./data/binance-analysis-cache.sqlite` | `H:\marketData\cache\binance-analysis-cache.sqlite` | SQLite file for the live API cache.                                           |
| `BINANCE_CACHE_MAX_ENTRIES`        | `10000`                                | `10000`                                             | Maximum SQLite cache entries; oldest entries are removed when exceeded.       |

The cache contains public API responses only. It never stores API keys, accounts, orders, or model conversations.

## Historical warehouse

| Variable                        | Default                            | Current desktop value                     | Description                                                                           |
| ------------------------------- | ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `WAREHOUSE_ENABLED`             | `true`                             | `true`                                    | Set to `false` to omit every `warehouse_*` MCP tool.                                  |
| `WAREHOUSE_PARQUET_ROOT`        | `./data/warehouse/parquet`         | `H:\marketData\warehouse\parquet`         | Root directory for managed Parquet files.                                             |
| `WAREHOUSE_METADATA_DB_PATH`    | `./data/warehouse/metadata.sqlite` | `H:\marketData\warehouse\metadata.sqlite` | SQLite import jobs, checksums, file ranges, and status.                               |
| `WAREHOUSE_TEMP_DIR`            | `./data/warehouse/tmp`             | `H:\marketData\warehouse\tmp`             | Scratch directory for HTTPS downloads and ZIP extraction; cleaned after a task.       |
| `WAREHOUSE_IMPORT_ROOTS`        | `./imports`                        | `H:\marketData\imports`                   | Allowlisted directories for `warehouse_import_file`. Separate Windows paths with `;`. |
| `WAREHOUSE_MAX_IMPORT_BYTES`    | `536870912`                        | `536870912`                               | Maximum size in bytes for one download, input file, or extracted ZIP CSV (512 MiB).   |
| `WAREHOUSE_DOWNLOAD_TIMEOUT_MS` | `120000`                           | `120000`                                  | Total timeout in milliseconds for one HTTPS download (120 seconds).                   |

Keep `WAREHOUSE_PARQUET_ROOT`, `WAREHOUSE_METADATA_DB_PATH`, and `WAREHOUSE_TEMP_DIR` on one reliable disk. `WAREHOUSE_IMPORT_ROOTS` may be a separate staging directory but must not be a drive root.

## Codex TOML example

The following is the active configuration. Windows backslashes must be escaped as `\\` in TOML strings:

```toml
[mcp_servers.binance-analysis.env]
BINANCE_REST_BASE_URL = "https://api.binance.com"
BINANCE_FUTURES_REST_BASE_URL = "https://fapi.binance.com"
BINANCE_REQUEST_TIMEOUT_MS = "20000"
BINANCE_CACHE_TTL_MS = "15000"
BINANCE_CANDLE_CACHE_TTL_MS = "60000"
BINANCE_FUNDING_CACHE_TTL_MS = "600000"
BINANCE_PERSISTENT_CACHE_ENABLED = "true"
BINANCE_CACHE_DB_PATH = "H:\\marketData\\cache\\binance-analysis-cache.sqlite"
BINANCE_CACHE_MAX_ENTRIES = "10000"
WAREHOUSE_ENABLED = "true"
WAREHOUSE_PARQUET_ROOT = "H:\\marketData\\warehouse\\parquet"
WAREHOUSE_METADATA_DB_PATH = "H:\\marketData\\warehouse\\metadata.sqlite"
WAREHOUSE_TEMP_DIR = "H:\\marketData\\warehouse\\tmp"
WAREHOUSE_IMPORT_ROOTS = "H:\\marketData\\imports"
WAREHOUSE_MAX_IMPORT_BYTES = "536870912"
WAREHOUSE_DOWNLOAD_TIMEOUT_MS = "120000"
```

The repository `.env.example` is a local-development default and is not read automatically by the server. Set these values through the MCP client environment for desktop or production usage.

## Verify a change

After changing paths, start a new Codex task and call:

```text
Call warehouse_status from binance-analysis.
```

Its `parquetRoot`, `metadataDatabasePath`, and `importRoots` must match the new settings. Then put a file under `H:\marketData\imports` and call `warehouse_import_file` to verify the local allowlist.
