# MCP connection and troubleshooting

[简体中文](CONNECTING.zh-CN.md)

## Prerequisites

- Node.js 22.13 or later (the persistent cache uses the built-in `node:sqlite` module).
- Network access to Binance public Spot APIs.
- Codex Desktop, Codex CLI, the Codex IDE extension, or another client that supports local stdio MCP servers.

## 1. Build and test the protocol

```powershell
cd H:\Code\binance-analysis-mcp
npm install
npm run check
npm run build
npm run test:mcp
```

`test:mcp` launches the server through a real MCP client, performs initialize and `tools/list`, and verifies all live-analysis and warehouse tools without contacting Binance. To include a public market-data request, run:

```powershell
npm run test:mcp:live
```

## 2. Connect Codex

According to the official OpenAI documentation, Codex Desktop, the CLI, and the IDE extension share MCP configuration. The CLI is the recommended setup path:

```powershell
codex mcp add binance-analysis --env BINANCE_REST_BASE_URL=https://api.binance.com --env BINANCE_FUTURES_REST_BASE_URL=https://fapi.binance.com --env BINANCE_REQUEST_TIMEOUT_MS=20000 --env BINANCE_CACHE_TTL_MS=15000 --env BINANCE_CANDLE_CACHE_TTL_MS=60000 --env BINANCE_FUNDING_CACHE_TTL_MS=600000 --env BINANCE_PERSISTENT_CACHE_ENABLED=true --env BINANCE_CACHE_DB_PATH=H:\marketData\cache\binance-analysis-cache.sqlite --env WAREHOUSE_PARQUET_ROOT=H:\marketData\warehouse\parquet --env WAREHOUSE_METADATA_DB_PATH=H:\marketData\warehouse\metadata.sqlite --env WAREHOUSE_TEMP_DIR=H:\marketData\warehouse\tmp --env WAREHOUSE_IMPORT_ROOTS=H:\marketData\imports -- node H:\Code\binance-analysis-mcp\dist\index.js
codex mcp list
```

Alternatively, edit the user-level `~/.codex/config.toml` or `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.binance-analysis]
command = "node"
args = ["H:\\Code\\binance-analysis-mcp\\dist\\index.js"]
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true

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

After adding the configuration, start a new task in Codex Desktop or restart the relevant local client so it reloads MCP configuration. In the Codex CLI TUI, use `/mcp` to inspect active servers.

Official reference: [OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## 3. Verify in Codex

Send these requests in order and explicitly request tool use:

1. `Call market_overview from binance-analysis with symbol=BTCUSDT.`
2. `Call analyze_indicators with symbol=BTCUSDT, interval=1h, and limit=200.`
3. `Call order_book_snapshot with symbol=ETHUSDT and limit=100, then explain spreadPercent and bidAskImbalance.`
4. `Call analyze_futures with symbol=KORUUSDT, interval=1h, and limit=200.`
5. `Call warehouse_status and return the Parquet root and imported-file count.`

Check the returned symbol, candle count, `closeTime`, and MCP error state. Treat every conclusion as a market-data summary, not a trading recommendation.

## 4. Other stdio MCP clients

For clients that use JSON configuration:

```json
{
  "mcpServers": {
    "binance-analysis": {
      "command": "node",
      "args": ["H:\\Code\\binance-analysis-mcp\\dist\\index.js"],
      "env": {
        "BINANCE_REST_BASE_URL": "https://api.binance.com",
        "BINANCE_FUTURES_REST_BASE_URL": "https://fapi.binance.com",
        "BINANCE_REQUEST_TIMEOUT_MS": "20000",
        "BINANCE_CACHE_TTL_MS": "15000",
        "BINANCE_CANDLE_CACHE_TTL_MS": "60000",
        "BINANCE_FUNDING_CACHE_TTL_MS": "600000",
        "BINANCE_PERSISTENT_CACHE_ENABLED": "true",
        "BINANCE_CACHE_DB_PATH": "H:\\marketData\\cache\\binance-analysis-cache.sqlite",
        "BINANCE_CACHE_MAX_ENTRIES": "10000",
        "WAREHOUSE_ENABLED": "true",
        "WAREHOUSE_PARQUET_ROOT": "H:\\marketData\\warehouse\\parquet",
        "WAREHOUSE_METADATA_DB_PATH": "H:\\marketData\\warehouse\\metadata.sqlite",
        "WAREHOUSE_TEMP_DIR": "H:\\marketData\\warehouse\\tmp",
        "WAREHOUSE_IMPORT_ROOTS": "H:\\marketData\\imports",
        "WAREHOUSE_MAX_IMPORT_BYTES": "536870912",
        "WAREHOUSE_DOWNLOAD_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

The configuration-file location is client-specific. Do not use this JSON shape in Codex's TOML file.

## Troubleshooting

| Symptom                   | Check                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tools are not listed      | Run `npm run build` and `npm run test:mcp`; verify the absolute entry path; reload the client configuration.            |
| Server exits immediately  | Ensure an MCP client launches it over stdio; `node dist/index.js` is not a standalone HTTP service.                     |
| Network request times out | Run `npm run test:mcp:live`; check network and regional availability; increase the request timeout if needed.           |
| Binance returns 4xx/429   | Validate the symbol, reduce call frequency, increase cache TTL, and consult Binance's current rate-limit documentation. |
| An indicator is `null`    | Increase `limit`; indicators such as MACD need enough candles, and at least 100 is recommended.                         |
| Local import is rejected  | Confirm the real file path is under `WAREHOUSE_IMPORT_ROOTS`, then restart the MCP client after changing configuration. |
| Warehouse tools missing   | Confirm `WAREHOUSE_ENABLED=true`, rebuild, and start a new client task.                                                 |

## Security boundary

The project neither reads nor requires `BINANCE_API_KEY` or `BINANCE_API_SECRET`. Do not add keys to MCP configuration, `.env`, logs, or screenshots. A future account or trading feature should use a separate server, least-privilege credentials, Testnet first, and explicit confirmation before every action.
