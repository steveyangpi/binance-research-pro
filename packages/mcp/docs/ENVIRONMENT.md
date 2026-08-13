# Environment and storage configuration

[简体中文](ENVIRONMENT.zh-CN.md)

## Cross-platform defaults

The server does not depend on a source directory or drive letter. With no path configuration, `BINANCE_RESEARCH_DATA_DIR` resolves to:

| System  | Default root                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\BinanceResearchPro`                                                                   |
| macOS   | `$HOME/Library/Application Support/BinanceResearchPro`                                                |
| Linux   | `$XDG_DATA_HOME/binance-research-pro`, or `$HOME/.local/share/binance-research-pro` when XDG is unset |

Layout:

```text
<dataDirectory>/
  cache/market-cache.sqlite
  imports/
  warehouse/
    metadata.sqlite
    parquet/
    tmp/
```

Set `BINANCE_RESEARCH_DATA_DIR` to move the complete layout. `warehouse_status` reports the resolved `dataDirectory`, `parquetRoot`, `metadataDatabasePath`, and `importRoots`.

## Environment variables

| Variable                           | Default                    | Purpose                                           |
| ---------------------------------- | -------------------------- | ------------------------------------------------- |
| `BINANCE_RESEARCH_DATA_DIR`        | OS user data directory     | Root for all stateful data.                       |
| `BINANCE_REST_BASE_URL`            | `https://api.binance.com`  | Public Spot REST base URL.                        |
| `BINANCE_FUTURES_REST_BASE_URL`    | `https://fapi.binance.com` | Public USDⓈ-M Futures REST base URL.              |
| `BINANCE_REQUEST_TIMEOUT_MS`       | `10000`                    | HTTP timeout, up to 60000 ms.                     |
| `BINANCE_CACHE_TTL_MS`             | `15000`                    | Ticker, mark price, book, and open-interest TTL.  |
| `BINANCE_CANDLE_CACHE_TTL_MS`      | `60000`                    | Candle TTL.                                       |
| `BINANCE_FUNDING_CACHE_TTL_MS`     | `600000`                   | Funding-history TTL.                              |
| `BINANCE_PERSISTENT_CACHE_ENABLED` | `true`                     | Use only memory when `false`.                     |
| `BINANCE_CACHE_MAX_ENTRIES`        | `10000`                    | Maximum SQLite cache entries.                     |
| `WAREHOUSE_ENABLED`                | `true`                     | Do not register `warehouse_*` tools when `false`. |
| `WAREHOUSE_MAX_IMPORT_BYTES`       | `536870912`                | Download, input, or extracted CSV size limit.     |
| `WAREHOUSE_DOWNLOAD_TIMEOUT_MS`    | `120000`                   | HTTPS download timeout.                           |

Advanced path variables override values derived from the root:

- `BINANCE_CACHE_DB_PATH`
- `WAREHOUSE_PARQUET_ROOT`
- `WAREHOUSE_METADATA_DB_PATH`
- `WAREHOUSE_TEMP_DIR`
- `WAREHOUSE_IMPORT_ROOTS`

Separate multiple import roots with the operating system PATH delimiter: `;` on Windows and `:` on macOS/Linux. Never allowlist an entire drive root.

## Codex/plugin override example

The plugin needs no `env` by default. To keep using an existing data disk, configure only:

```json
{
  "mcpServers": {
    "binance-research-pro": {
      "command": "npx",
      "args": [
        "-y",
        "--package=@steveyangpi/binance-research-pro-mcp@0.3.1",
        "--",
        "binance-research-pro-mcp"
      ],
      "env": {
        "BINANCE_RESEARCH_DATA_DIR": "H:\\marketData"
      }
    }
  }
}
```

Both Binance endpoint overrides must use HTTPS. On another machine, omit the path override for OS defaults or set it to that host's data disk. Path changes do not migrate existing SQLite or Parquet files automatically.

## Migrating existing data

1. Stop every MCP process using the warehouse.
2. Copy the complete data root, including `cache`, `imports`, and `warehouse`.
3. Point `BINANCE_RESEARCH_DATA_DIR` at the destination, or copy into the OS default.
4. Start a new Codex task and call `warehouse_status`.
5. Confirm resolved paths and file counts before resuming imports.

Use only one metadata writer. Do not import during the copy, or SQLite and Parquet state can diverge.
