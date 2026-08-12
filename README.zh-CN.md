# Binance 分析 MCP 服务

[English](README.md)

这是一个 Binance Spot 和 USDⓈ-M Futures 市场分析 MCP Server。实时分析只调用公开市场数据接口，不要求 API Key，也不包含下单、转账或账户读取能力；历史数据可以导入本地 DuckDB/Parquet 仓库。

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

## 快速开始

```powershell
cd H:\Code\binance-analysis-mcp
npm install
npm run check
npm run build
npm run test:mcp
```

如需测试真实 Binance 公共行情请求：

```powershell
npm run test:mcp:live
```

## 本地持久化缓存

公共 API 响应默认缓存在 SQLite 数据库 `data/binance-analysis-cache.sqlite` 中。缓存可跨 MCP 进程重启复用，并为 Spot 和 Futures 使用独立命名空间。

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

存储路径不写死。当前 Codex Desktop 配置把全部运行数据放在 `H:\marketData`；默认 Parquet 根目录仍为 `data/warehouse/parquet`，可通过环境变量覆盖。完整字段、路径布局、导入示例和限制见 [数据仓库指南](docs/WAREHOUSE.zh-CN.md) 与 [环境变量参考](docs/ENVIRONMENT.zh-CN.md)。

服务通过 stdin/stdout 传输 MCP 消息，因此应用日志不得写入 stdout。详细接入步骤见 [连接和排障指南](docs/CONNECTING.zh-CN.md)，代码边界见 [架构与规范](docs/ARCHITECTURE.zh-CN.md)。

## 示例提问

专属 `Binance Research Pro` 插件位于 `H:\Code\binance-research-pro`。它通过 `.mcp.json` 启动本服务，并提供 Spot、衍生品、历史数据和风险审查 Skills。第一阶段只使用无需 API Key 的公共市场数据，不读取账户、不下单。

- 分析 BTCUSDT 最近 200 根 1 小时 K 线的趋势、RSI 和 MACD。
- 比较 BTCUSDT、ETHUSDT 和 SOLUSDT 的 24 小时成交额与涨跌幅。
- 读取 ETHUSDT 前 100 档盘口，说明价差和买卖盘失衡。
- 使用标记价格、资金费率、持仓量和一小时指标分析 KORUUSDT 永续合约。
- 将 `H:\MarketImports\BTCUSDT-1h-2025-01.zip` 作为 Binance Kline 导入 `candles` 数据集，然后查询时间范围。

## 数据来源

实现基于 Binance 官方 [Spot REST API](https://developers.binance.com/en/docs/products/spot/rest-api) 和 [USDⓈ-M Futures API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api) 的公开市场数据端点。请确认 Binance 服务在你的司法辖区可用，并遵守最新 API 限流和使用政策。
