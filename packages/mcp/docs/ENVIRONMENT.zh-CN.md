# 环境变量与存储配置

[English](ENVIRONMENT.md)

## 跨平台默认目录

服务不依赖源码目录或盘符。未设置路径变量时，`BINANCE_RESEARCH_DATA_DIR` 自动解析为：

| 系统    | 默认根目录                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------ |
| Windows | `%LOCALAPPDATA%\BinanceResearchPro`                                                              |
| macOS   | `$HOME/Library/Application Support/BinanceResearchPro`                                           |
| Linux   | `$XDG_DATA_HOME/binance-research-pro`，未设置 XDG 时为 `$HOME/.local/share/binance-research-pro` |

根目录布局：

```text
<dataDirectory>/
  cache/market-cache.sqlite
  imports/
  warehouse/
    metadata.sqlite
    parquet/
    tmp/
```

设置 `BINANCE_RESEARCH_DATA_DIR` 可整体移动上述目录。`warehouse_status` 会返回最终的 `dataDirectory`、`parquetRoot`、`metadataDatabasePath` 和 `importRoots`。

## 环境变量

| 变量                               | 默认值                     | 说明                                     |
| ---------------------------------- | -------------------------- | ---------------------------------------- |
| `BINANCE_RESEARCH_DATA_DIR`        | 当前系统用户数据目录       | 所有状态数据的根目录。                   |
| `BINANCE_REST_BASE_URL`            | `https://api.binance.com`  | Spot 公共 REST 根地址。                  |
| `BINANCE_FUTURES_REST_BASE_URL`    | `https://fapi.binance.com` | USDⓈ-M Futures 公共 REST 根地址。        |
| `BINANCE_ACCOUNT_PROFILES_PATH`    | 未设置                     | 外部 Ed25519 USER_DATA Profile 文件。    |
| `BINANCE_ACCOUNT_RECV_WINDOW_MS`   | `5000`                     | 签名请求窗口，最大 60000 毫秒。          |
| `BINANCE_REQUEST_TIMEOUT_MS`       | `10000`                    | HTTP 超时，最大 60000 毫秒。             |
| `BINANCE_CACHE_TTL_MS`             | `15000`                    | ticker、标记价格、盘口、持仓量缓存时间。 |
| `BINANCE_CANDLE_CACHE_TTL_MS`      | `60000`                    | K 线缓存时间。                           |
| `BINANCE_FUNDING_CACHE_TTL_MS`     | `600000`                   | 资金费率历史缓存时间。                   |
| `BINANCE_PERSISTENT_CACHE_ENABLED` | `true`                     | `false` 时只使用内存缓存。               |
| `BINANCE_CACHE_MAX_ENTRIES`        | `10000`                    | SQLite 缓存最大条目数。                  |
| `WAREHOUSE_ENABLED`                | `true`                     | `false` 时不注册 `warehouse_*` 工具。    |
| `WAREHOUSE_MAX_IMPORT_BYTES`       | `536870912`                | 下载、输入文件或 ZIP 解压 CSV 的上限。   |
| `WAREHOUSE_DOWNLOAD_TIMEOUT_MS`    | `120000`                   | HTTPS 下载总超时。                       |

以下高级变量优先级高于根目录派生值：

- `BINANCE_CACHE_DB_PATH`
- `WAREHOUSE_PARQUET_ROOT`
- `WAREHOUSE_METADATA_DB_PATH`
- `WAREHOUSE_TEMP_DIR`
- `WAREHOUSE_IMPORT_ROOTS`

多个导入根目录使用操作系统 PATH 分隔符：Windows 为 `;`，macOS/Linux 为 `:`。导入目录不要设置成磁盘根目录。

## Codex/插件覆盖示例

插件默认不需要任何 `env`。如需继续使用原来的数据盘，只配置：

```json
{
  "mcpServers": {
    "binance-research-pro": {
      "command": "npx",
      "args": [
        "-y",
        "--package=@steveyangpi/binance-research-pro-mcp@1.0.0",
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

两个 Binance 端点覆盖值都必须使用 HTTPS。公共工具可以使用自定义 HTTPS 端点，但签名账户请求只接受账户访问指南列出的 Binance origin，并拒绝重定向。更换机器时可以省略路径覆盖，让新机器使用系统默认目录；也可以改成新机器的数据盘。路径变化不会自动迁移现有 SQLite 或 Parquet 文件。

## 可选只读账户 Profile

账户凭据不会直接写入 `.mcp.json` 或多个独立环境变量。只需将 `BINANCE_ACCOUNT_PROFILES_PATH` 指向仓库外受保护的 JSON 文件。该文件可以声明多个隔离的 Ed25519 Profile 以及各自允许的 `spot` 或 `usd-m-futures` 市场。详见仓库的[账户访问指南](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/ACCOUNT-ACCESS.zh-CN.md)。

私有响应绕过公共响应缓存和历史仓库。修改 Profile 路径或凭据文件后必须完全重启宿主。

## 迁移现有数据

1. 停止所有使用该仓库的 MCP 进程。
2. 复制完整数据根目录，至少包含 `cache`、`imports` 和 `warehouse`。
3. 将 `BINANCE_RESEARCH_DATA_DIR` 指向新目录，或把文件放进系统默认目录。
4. 新建 Codex 任务并调用 `warehouse_status`。
5. 确认所有返回路径和文件计数，再恢复导入操作。

同一元数据数据库只应有一个写进程。复制期间不要导入，以避免 SQLite 与 Parquet 状态不一致。
