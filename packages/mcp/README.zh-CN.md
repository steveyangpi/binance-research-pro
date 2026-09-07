# Binance Research Pro MCP 服务

[English](README.md)

这是一个 Binance Spot 和 USDⓈ-M Futures 研究 MCP Server。公共分析不要求 API Key；可选的隔离 Ed25519 `USER_DATA` Profile 可增加余额、仓位、挂单与收益历史的只读访问。历史数据可以导入本地 DuckDB/Parquet 仓库。项目不实现交易、调整杠杆、转账或提现操作。

> 市场数据和技术指标仅供分析，不构成投资建议。数字资产价格可能剧烈波动，请自行验证数据、规则和风险。

## 功能

| MCP 工具                   | 说明                                                   |
| -------------------------- | ------------------------------------------------------ |
| `market_overview`          | 获取单个交易对或成交额最高的 USDT 交易对的 24 小时行情 |
| `get_candles`              | 获取标准化 OHLCV K 线                                  |
| `analyze_indicators`       | 计算 SMA、EMA、RSI、MACD、布林带和 ATR                 |
| `analyze_trend`            | 汇总单周期趋势和动量状态                               |
| `order_book_snapshot`      | 获取盘口深度并计算价差和名义金额失衡                   |
| `exchange_info`            | 获取交易状态、精度、订单类型与交易过滤器               |
| `compare_markets`          | 比较 2–20 个 Spot 交易对的 24 小时数据                 |
| `multi_timeframe_analysis` | 分析 2–5 个周期的趋势一致性                            |

### USDⓈ-M Futures 工具

| MCP 工具                      | 说明                                            |
| ----------------------------- | ----------------------------------------------- |
| `futures_market_overview`     | 获取永续合约 24 小时行情                        |
| `futures_mark_price`          | 获取标记/指数价格、基差、资金费率和下次结算时间 |
| `futures_candles`             | 获取标准化合约 OHLCV K 线                       |
| `futures_order_book_snapshot` | 获取合约盘口、价差和名义金额失衡                |
| `futures_open_interest`       | 获取合约当前持仓量                              |
| `futures_funding_rate`        | 获取历史资金费率                                |
| `analyze_futures`             | 综合价格、基差、资金费率、持仓量和技术指标      |

### 本地数据仓库工具

| MCP 工具                  | 说明                                   |
| ------------------------- | -------------------------------------- |
| `warehouse_import_file`   | 从白名单目录导入 CSV、ZIP 或 Parquet   |
| `warehouse_import_url`    | 下载并导入 HTTPS 文件，可校验 SHA-256  |
| `warehouse_status`        | 查看存储路径、限额与导入统计           |
| `warehouse_list_datasets` | 查看已导入数据集、标的、周期与时间范围 |
| `warehouse_list_files`    | 查看 Parquet 文件及其导入元数据        |
| `warehouse_query_candles` | 查询并按开盘时间去重的历史 K 线        |
| `warehouse_data_range`    | 查询 K 线行数及最早/最晚时间           |

### 可选只读账户工具

| MCP 工具                  | 说明                                         |
| ------------------------- | -------------------------------------------- |
| `account_profiles_status` | 查看脱敏后的 Profile 元数据                  |
| `spot_account_overview`   | 读取 Spot 余额                               |
| `futures_positions`       | 读取 USDⓈ-M 仓位风险                         |
| `futures_open_orders`     | 读取当前 USDⓈ-M 挂单                         |
| `futures_income_history`  | 读取已实现盈亏、资金费、手续费和其他收益记录 |

私有账户金额与 ID 均以字符串返回，以无损保留 Binance 的十进制和整数表示。签名账户请求只允许文档列出的 Binance origin，并且不会跟随重定向。

## 快速开始

需要 Node.js 22.13 或更高版本。访问私有 GitHub Packages 前，先配置 `@steveyangpi` registry，并使用有权读取该 restricted 包的账号完成认证：

```powershell
npm config set @steveyangpi:registry https://npm.pkg.github.com
npm login --scope=@steveyangpi --auth-type=legacy --registry=https://npm.pkg.github.com
npx -y --package=@steveyangpi/binance-research-pro-mcp@1.0.0 -- binance-research-pro-mcp
```

该命令是 stdio server，会等待 MCP JSON-RPC 输入。未设置 `BINANCE_ACCOUNT_PROFILES_PATH` 时，账户工具返回“未配置”，公共工具和仓库工具仍可使用。凭据必须保存在仓库外受保护的文件中。设置 `BINANCE_RESEARCH_DATA_DIR` 可迁移本地缓存与仓库。详见仓库的[安装指南](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/INSTALLATION.zh-CN.md)和[账户访问指南](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/ACCOUNT-ACCESS.zh-CN.md)。

从源码开发：

```powershell
cd <binance-research-pro 仓库目录>
npm install
npm run check
npm run test:package
```

如需测试真实 Binance 公共行情请求：

```powershell
npm run test:mcp:live
```

## 本地持久化缓存

公共 API 响应默认缓存在系统用户数据目录的 SQLite 中。缓存可跨 MCP 进程重启复用，并为 Spot 和 Futures 使用独立命名空间。

- 行情、标记价格、盘口和持仓量：15 秒
- K 线：60 秒
- 资金费率历史：10 分钟
- 最多保存 10,000 条，定期清理过期和最旧记录

可通过 `.env.example` 中的 `BINANCE_CACHE_*` 环境变量调整数据库和 TTL。设置 `BINANCE_PERSISTENT_CACHE_ENABLED=false` 可退回仅内存缓存。

## DuckDB/Parquet 历史仓库

仓库和短期 API 缓存用途不同：SQLite 缓存减少重复网络请求；Parquet 仓库用于多标的、多年份分析，DuckDB 直接查询这些列式文件。首版提供三个导入配置：

- `binance-kline`：Binance 官方无表头的 12 列 Kline CSV/ZIP；自动识别毫秒和微秒时间戳，并按年/月分区。
- `generic-csv`：有表头的普通 CSV（可设置 `hasHeader=false`）；保留 DuckDB 推断的原始列，只附加导入审计列。
- `parquet`：将现有 Parquet 复制到受管仓库并登记元数据。

存储路径不写死。默认使用 Windows、macOS 或 Linux 的用户应用数据目录；设置一个 `BINANCE_RESEARCH_DATA_DIR` 即可整体迁移，细粒度路径变量仍可覆盖。完整字段、路径布局、导入示例和限制见 [数据仓库指南](docs/WAREHOUSE.zh-CN.md) 与 [环境变量参考](docs/ENVIRONMENT.zh-CN.md)。

服务通过 stdin/stdout 传输 MCP 消息，因此应用日志不得写入 stdout。详细接入步骤见 [连接和排障指南](docs/CONNECTING.zh-CN.md)，代码边界见 [架构与规范](docs/ARCHITECTURE.zh-CN.md)。

## 示例提问

仓库插件适配层分别通过 Codex 的 `.mcp.json` 和 Claude Code 的 `claude.mcp.json` 启动本服务，并提供共享的 Spot、衍生品、历史数据、账户研究和风险审查 Skills。账户研究必须显式配置只读 Profile，所有交易操作仍然排除在外。

- 分析 BTCUSDT 最近 200 根 1 小时 K 线的趋势、RSI 和 MACD。
- 比较 BTCUSDT、ETHUSDT 和 SOLUSDT 的 24 小时成交额与涨跌幅。
- 读取 ETHUSDT 前 100 档盘口，说明价差和买卖盘失衡。
- 使用标记价格、资金费率、持仓量和一小时指标分析 KORUUSDT 永续合约。
- 结合当前标记价格、资金费、杠杆和强平距离审查已配置的 USDⓈ-M 仓位。
- 将配置的导入目录中的 `BTCUSDT-1h-2025-01.zip` 作为 Binance Kline 导入 `candles` 数据集，然后查询时间范围。

## 数据来源

实现基于 Binance 官方 [Spot REST API](https://developers.binance.com/en/docs/products/spot/rest-api) 和 [USDⓈ-M Futures API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api) 的公开市场数据端点。请确认 Binance 服务在你的司法辖区可用，并遵守最新 API 限流和使用政策。
