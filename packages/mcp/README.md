# Binance Research Pro MCP Server

[简体中文](README.zh-CN.md)

A Binance Spot and USD-M Futures research MCP server. Public analysis requires no API key; optional isolated Ed25519 `USER_DATA` profiles add read-only balances, positions, open orders, and income history. Historical files can be imported into a local DuckDB/Parquet warehouse. No trading, leverage-change, transfer, or withdrawal action is implemented.

> Market data and technical indicators are for analysis only and are not investment advice. Digital-asset prices can be highly volatile; verify the data, rules, and risks independently.

## Features

| MCP tool                   | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `market_overview`          | Get 24-hour statistics for one symbol or the most liquid USDT pairs |
| `get_candles`              | Get normalized OHLCV candlesticks                                   |
| `analyze_indicators`       | Calculate SMA, EMA, RSI, MACD, Bollinger Bands, and ATR             |
| `analyze_trend`            | Summarize single-timeframe trend and momentum state                 |
| `order_book_snapshot`      | Get order-book depth and calculate spread and notional imbalance    |
| `exchange_info`            | Get symbol status, precision, order types, and trading filters      |
| `compare_markets`          | Compare 2–20 Spot symbols using normalized 24-hour data             |
| `multi_timeframe_analysis` | Analyze trend alignment across 2–5 intervals                        |

### USD-M Futures tools

| MCP tool                      | Description                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| `futures_market_overview`     | Get 24-hour perpetual-contract statistics                              |
| `futures_mark_price`          | Get mark/index prices, basis, funding rate, and next funding time      |
| `futures_candles`             | Get normalized USD-M Futures OHLCV candlesticks                        |
| `futures_order_book_snapshot` | Get Futures depth, spread, and notional imbalance                      |
| `futures_open_interest`       | Get current contract open interest                                     |
| `futures_funding_rate`        | Get historical funding rates                                           |
| `analyze_futures`             | Combine price, basis, funding, open interest, and technical indicators |

### Local data warehouse tools

| MCP tool                  | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `warehouse_import_file`   | Import CSV, ZIP, or Parquet from an allowlisted directory |
| `warehouse_import_url`    | Download an HTTPS file, optionally verify SHA-256, import |
| `warehouse_status`        | Show configured paths, limits, and import totals          |
| `warehouse_list_datasets` | List datasets, symbols, intervals, and time ranges        |
| `warehouse_list_files`    | List managed Parquet files and import metadata            |
| `warehouse_query_candles` | Query deduplicated historical Klines                      |
| `warehouse_data_range`    | Get Kline row count and earliest/latest open time         |

### Optional read-only account tools

| MCP tool                  | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `account_profiles_status` | List redacted configured profile metadata                  |
| `spot_account_overview`   | Read Spot balances                                         |
| `futures_positions`       | Read USD-M position risk                                   |
| `futures_open_orders`     | Read current USD-M open orders                             |
| `futures_income_history`  | Read realized PnL, funding, commission, and income records |

Private monetary values and identifiers are returned as strings to preserve exact Binance decimal and integer representations. Signed account requests are restricted to documented Binance origins and never follow redirects.

## Quick start

Requires Node.js 22.13 or later. For private GitHub Packages access, configure the `@steveyangpi` registry and authenticate with an account authorized to read this restricted package before running the server:

```powershell
npm config set @steveyangpi:registry https://npm.pkg.github.com
npm login --scope=@steveyangpi --auth-type=legacy --registry=https://npm.pkg.github.com
npx -y --package=@steveyangpi/binance-research-pro-mcp@1.0.0 -- binance-research-pro-mcp
```

The command is a stdio server and waits for MCP JSON-RPC input. Without `BINANCE_ACCOUNT_PROFILES_PATH`, account tools report an unconfigured state while public and warehouse tools remain available. Credentials must stay in a protected external file. Set `BINANCE_RESEARCH_DATA_DIR` to move the optional local cache and warehouse. See the repository's [installation guide](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/INSTALLATION.md) and [account-access guide](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/ACCOUNT-ACCESS.md).

Develop from source:

```powershell
cd <binance-research-pro repository>
npm install
npm run check
npm run test:package
```

To include a live request to Binance public market data:

```powershell
npm run test:mcp:live
```

## Local persistent cache

Public API responses are cached in SQLite under the operating system's per-user application-data directory by default. The cache survives MCP process restarts and uses separate namespaces for Spot and Futures.

- Market price, mark price, order book, and open interest: 15 seconds
- Candlesticks: 60 seconds
- Funding-rate history: 10 minutes
- Maximum stored entries: 10,000, with expired and oldest-entry cleanup

Configure the database and TTL values with the `BINANCE_CACHE_*` environment variables in `.env.example`. Set `BINANCE_PERSISTENT_CACHE_ENABLED=false` to use memory-only caching.

## DuckDB/Parquet history warehouse

The warehouse serves a different purpose than the short-lived API cache. SQLite avoids repeated network calls; Parquet stores multi-symbol, multi-year data and DuckDB queries it in place. V1 has three profiles:

- `binance-kline`: official headerless 12-column Binance Kline CSV/ZIP, automatic ms/us timestamp handling, and year/month partitioning.
- `generic-csv`: regular CSV (header by default); preserves DuckDB-inferred source columns and adds audit columns.
- `parquet`: copies existing Parquet into the managed warehouse and records its metadata.

No storage location is hardcoded. Defaults use the current user's application-data directory on Windows, macOS, or Linux. Set `BINANCE_RESEARCH_DATA_DIR` to move all state, while advanced per-path variables still take precedence. See the [warehouse guide](docs/WAREHOUSE.md) and [environment reference](docs/ENVIRONMENT.md) for paths, the full contract, and examples.

The server transports MCP messages over stdin/stdout, so application logs must never be written to stdout. See the [connection and troubleshooting guide](docs/CONNECTING.md) for client setup and [architecture and conventions](docs/ARCHITECTURE.md) for code boundaries.

## Example prompts

The repository plugin adapters launch this server through `.mcp.json` for Codex and `claude.mcp.json` for Claude Code, and provide shared Spot, derivatives, history, account-research, and risk-review Skills. Account research requires an explicitly configured read-only Profile; trading remains unavailable.

- Analyze the trend, RSI, and MACD of the latest 200 one-hour BTCUSDT candles.
- Compare BTCUSDT, ETHUSDT, and SOLUSDT by 24-hour quote volume and price change.
- Inspect the first 100 ETHUSDT order-book levels and explain the spread and imbalance.
- Analyze the KORUUSDT perpetual contract using mark price, funding, open interest, and one-hour indicators.
- Review configured USD-M positions against current mark prices, funding, leverage, and liquidation distance.
- Import `BTCUSDT-1h-2025-01.zip` from the configured import directory as Binance Klines and inspect its data range.

## Data source

The implementation uses public market-data endpoints from Binance's official [Spot REST API](https://developers.binance.com/en/docs/products/spot/rest-api) and [USD-M Futures API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api). Confirm that Binance is available in your jurisdiction and follow the current API limits and terms of use.
