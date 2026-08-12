# MCP 接入与排障

[English](CONNECTING.md)

## 前置条件

- Node.js 22.13 或更高版本（持久化缓存使用内置 `node:sqlite` 模块）。
- 能访问 Binance 公共 Spot API 的网络环境。
- Codex Desktop、Codex CLI、Codex IDE 扩展，或其他支持本地 stdio MCP 的客户端。

## 1. 构建并进行协议测试

```powershell
cd H:\Code\binance-analysis-mcp
npm install
npm run check
npm run build
npm run test:mcp
```

`test:mcp` 会作为真实 MCP 客户端启动 Server，执行 initialize 和 `tools/list`，并确认全部实时分析和仓库工具均已注册，但不会访问 Binance。测试公共行情网络请求时运行：

```powershell
npm run test:mcp:live
```

## 2. 连接 Codex

OpenAI 官方文档说明 Codex Desktop、CLI 和 IDE 扩展共享同一份 MCP 配置。推荐使用 CLI 添加：

```powershell
codex mcp add binance-analysis --env BINANCE_REST_BASE_URL=https://api.binance.com --env BINANCE_FUTURES_REST_BASE_URL=https://fapi.binance.com --env BINANCE_REQUEST_TIMEOUT_MS=20000 --env BINANCE_CACHE_TTL_MS=15000 --env BINANCE_CANDLE_CACHE_TTL_MS=60000 --env BINANCE_FUNDING_CACHE_TTL_MS=600000 --env BINANCE_PERSISTENT_CACHE_ENABLED=true --env BINANCE_CACHE_DB_PATH=H:\marketData\cache\binance-analysis-cache.sqlite --env WAREHOUSE_PARQUET_ROOT=H:\marketData\warehouse\parquet --env WAREHOUSE_METADATA_DB_PATH=H:\marketData\warehouse\metadata.sqlite --env WAREHOUSE_TEMP_DIR=H:\marketData\warehouse\tmp --env WAREHOUSE_IMPORT_ROOTS=H:\marketData\imports -- node H:\Code\binance-analysis-mcp\dist\index.js
codex mcp list
```

也可以编辑用户级 `~/.codex/config.toml`，或可信项目中的 `.codex/config.toml`：

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

新增配置后，在 Codex Desktop 中开启一个新任务，或重新启动对应的本地客户端，使其重新读取 MCP 配置。在 Codex CLI 的 TUI 中可使用 `/mcp` 查看活动服务。

官方配置参考：[OpenAI Codex MCP 文档](https://developers.openai.com/codex/mcp/)。

## 3. 在 Codex 中验证

依次发送以下请求，并明确要求调用工具：

1. `调用 binance-analysis 的 market_overview，symbol=BTCUSDT。`
2. `调用 analyze_indicators，symbol=BTCUSDT，interval=1h，limit=200。`
3. `调用 order_book_snapshot，symbol=ETHUSDT，limit=100，并解释 spreadPercent 和 bidAskImbalance。`
4. `调用 analyze_futures，symbol=KORUUSDT，interval=1h，limit=200。`
5. `调用 warehouse_status，并返回 Parquet 根目录与已导入文件数。`

验证返回值中的交易对、K 线数量、`closeTime` 和工具错误状态。分析结论必须被视为市场数据摘要，而不是交易建议。

## 4. 其他 stdio MCP 客户端

客户端若使用 JSON 配置，可采用：

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

具体配置文件位置由客户端决定；不要把 Codex 的 TOML 配置误写成 JSON。

## 常见问题

| 现象                  | 检查方式                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 客户端没有列出工具    | 运行 `npm run build` 和 `npm run test:mcp`；检查入口文件绝对路径；让客户端重新加载配置。 |
| Server 启动后立即退出 | 确认客户端通过 stdio 启动它；不要把 `node dist/index.js` 当成普通 HTTP 服务。            |
| 网络请求超时          | 运行 `npm run test:mcp:live`；检查网络和区域可用性；适当提高请求超时。                   |
| Binance 返回 4xx/429  | 检查交易对、降低调用频率、增加缓存 TTL，并参考 Binance 最新限流文档。                    |
| 指标为 `null`         | 增加 `limit`；MACD 等指标需要足够多的 K 线，推荐至少 100 根。                            |
| 本地导入被拒绝        | 确认文件真实路径位于 `WAREHOUSE_IMPORT_ROOTS`，修改环境变量后重启 MCP 客户端。           |
| 仓库工具未显示        | 确认 `WAREHOUSE_ENABLED=true`，重新构建并让客户端启动一个新任务。                        |

## 安全边界

项目不读取或要求 `BINANCE_API_KEY` / `BINANCE_API_SECRET`。不要将密钥加入 MCP 配置、`.env`、日志或截图。未来若增加账户或交易功能，应使用独立 Server、最小权限密钥、Testnet 优先和操作前确认。
