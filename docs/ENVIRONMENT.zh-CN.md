# 环境变量与存储配置

[English](ENVIRONMENT.md)

## 当前 Codex Desktop 配置

当前 `binance-analysis` MCP Server 的运行数据统一存储在 `H:\marketData`：

```text
H:\marketData\
  cache\
    binance-analysis-cache.sqlite       # 实时公共 API 短期缓存
  imports\                              # warehouse_import_file 允许读取的本地文件
  warehouse\
    metadata.sqlite                     # 导入任务与 Parquet 文件元数据
    parquet\                            # 历史数据列式文件
    tmp\                                # 下载和 ZIP 解压的临时文件
```

目录由 MCP Server 在首次启动或第一次导入时自动创建。原 `H:\Code\binance-analysis-mcp\data` 中的缓存和仓库文件不会自动移动；它们可以保留作为历史副本。

环境变量由 Codex 配置中的 `[mcp_servers.binance-analysis.env]` 传递。修改后必须在 Codex Desktop 中开启新任务或重启客户端，正在运行的 Server 不会自动读取新值。

## Binance 公共行情与缓存

| 变量                               | 默认值                                 | 当前桌面配置                                        | 说明                                                 |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `BINANCE_REST_BASE_URL`            | `https://api.binance.com`              | 同默认值                                            | Spot 公共 REST API 根地址。                          |
| `BINANCE_FUTURES_REST_BASE_URL`    | `https://fapi.binance.com`             | 同默认值                                            | USDⓈ-M Futures 公共 REST API 根地址。                |
| `BINANCE_REQUEST_TIMEOUT_MS`       | `10000`                                | `20000`                                             | 单个 Binance HTTP 请求超时，单位毫秒，最大 60000。   |
| `BINANCE_CACHE_TTL_MS`             | `15000`                                | `15000`                                             | ticker、标记价格、盘口、持仓量等缓存时间，单位毫秒。 |
| `BINANCE_CANDLE_CACHE_TTL_MS`      | `60000`                                | `60000`                                             | Spot/Futures K 线缓存时间，单位毫秒。                |
| `BINANCE_FUNDING_CACHE_TTL_MS`     | `600000`                               | `600000`                                            | Futures 资金费率历史缓存时间，单位毫秒。             |
| `BINANCE_PERSISTENT_CACHE_ENABLED` | `true`                                 | `true`                                              | `true` 使用 SQLite；`false` 仅使用进程内内存缓存。   |
| `BINANCE_CACHE_DB_PATH`            | `./data/binance-analysis-cache.sqlite` | `H:\marketData\cache\binance-analysis-cache.sqlite` | 实时 API 缓存 SQLite 文件。                          |
| `BINANCE_CACHE_MAX_ENTRIES`        | `10000`                                | `10000`                                             | SQLite 缓存最大条目数；达到上限时删除最旧条目。      |

缓存只保存公开接口返回值，不会保存 API Key、账户、订单或模型对话内容。

## 历史数据仓库

| 变量                            | 默认值                             | 当前桌面配置                              | 说明                                                            |
| ------------------------------- | ---------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `WAREHOUSE_ENABLED`             | `true`                             | `true`                                    | 设为 `false` 时不注册任何 `warehouse_*` MCP 工具。              |
| `WAREHOUSE_PARQUET_ROOT`        | `./data/warehouse/parquet`         | `H:\marketData\warehouse\parquet`         | 受管 Parquet 数据根目录。                                       |
| `WAREHOUSE_METADATA_DB_PATH`    | `./data/warehouse/metadata.sqlite` | `H:\marketData\warehouse\metadata.sqlite` | SQLite 导入任务、校验和、文件范围和状态。                       |
| `WAREHOUSE_TEMP_DIR`            | `./data/warehouse/tmp`             | `H:\marketData\warehouse\tmp`             | HTTPS 下载和 ZIP 解压临时目录；任务结束后自动清理。             |
| `WAREHOUSE_IMPORT_ROOTS`        | `./imports`                        | `H:\marketData\imports`                   | `warehouse_import_file` 的允许目录。Windows 多目录用 `;` 分隔。 |
| `WAREHOUSE_MAX_IMPORT_BYTES`    | `536870912`                        | `536870912`                               | 单个下载、输入文件或 ZIP 解压 CSV 的上限，单位字节（512 MiB）。 |
| `WAREHOUSE_DOWNLOAD_TIMEOUT_MS` | `120000`                           | `120000`                                  | 单次 HTTPS 下载总超时，单位毫秒（120 秒）。                     |

`WAREHOUSE_PARQUET_ROOT`、`WAREHOUSE_METADATA_DB_PATH` 和 `WAREHOUSE_TEMP_DIR` 应保持在同一可靠磁盘中。`WAREHOUSE_IMPORT_ROOTS` 可以指向另一个只存放待导入文件的目录，但不得设置为磁盘根目录。

## Codex TOML 示例

以下是当前生效的配置片段；TOML 的 Windows 反斜杠必须写成 `\\`：

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

项目中的 `.env.example` 是本地开发默认示例，不会被 Server 自动读取。生产或桌面接入时，请通过 MCP 客户端环境变量设置这些值。

## 修改检查

修改路径后新建一个 Codex 任务，调用：

```text
调用 binance-analysis 的 warehouse_status。
```

返回的 `parquetRoot`、`metadataDatabasePath` 与 `importRoots` 应与设置一致。再把待导入文件放进 `H:\marketData\imports`，调用 `warehouse_import_file` 验证本地白名单。
