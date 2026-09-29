# 本地数据仓库指南

[English](WAREHOUSE.md)

## 目标和边界

本仓库用于把不同接口或数据源产出的文件统一导入本地 Parquet，再由 DuckDB 查询。它不是多平台 API 连接框架。当前不处理复杂字段映射、币种别名、交易日历、复权或冲突合并；这些能力以后可以作为新的导入配置加入，不需要改仓库核心。

SQLite 只保存导入任务和 Parquet 文件元数据，不承载多年行情明细。行情明细存储在可配置的 Parquet 根目录中。

## 配置

```dotenv
WAREHOUSE_ENABLED=true
WAREHOUSE_PARQUET_ROOT=H:\marketData\warehouse\parquet
WAREHOUSE_METADATA_DB_PATH=H:\marketData\warehouse\metadata.sqlite
WAREHOUSE_TEMP_DIR=H:\marketData\warehouse\tmp
WAREHOUSE_IMPORT_ROOTS=H:\marketData\imports
WAREHOUSE_MAX_IMPORT_BYTES=536870912
WAREHOUSE_DOWNLOAD_TIMEOUT_MS=120000
WAREHOUSE_DUCKDB_MEMORY_LIMIT=1GB
```

`WAREHOUSE_DUCKDB_MEMORY_LIMIT` 为可选项。设置后 DuckDB 超过该上限会把中间结果溢写到 `WAREHOUSE_TEMP_DIR`，而不是无上限增长，可避免头部交易对的逐笔文件把内存打满。插件通过 `.mcp.json` 透传该变量；不是 `512MB`、`2GiB` 这类尺寸的值会在启动时报错。

Windows 多个导入根目录使用分号分隔，例如 `H:\MarketImports;D:\ResearchExports`。修改配置后重新构建不是必需的，但必须重启 MCP 客户端任务，让 Server 进程读取新环境变量。

存储结构示例：

```text
H:\marketData\warehouse\parquet\
  dataset=candles\
    source=binance-public-data\
      market=um\symbol=BTCUSDT\interval=1h\
        import=<uuid>\year=2025\month=1\data_0.parquet
```

每次成功导入使用唯一目录，避免覆盖历史文件。相同文件、元数据和解析选项再次导入时，SHA-256 去重会直接返回原任务。

## 导入配置

### `binance-kline`

输入必须是 Binance 官方顺序的无表头 12 列 CSV，或包含该 CSV 的 ZIP：

```text
open_time,open,high,low,close,volume,close_time,quote_asset_volume,
trade_count,taker_buy_base_asset_volume,taker_buy_quote_asset_volume,ignore
```

必须提供 `symbol` 和 `interval`，建议同时提供 `market=spot|um|cm`。时间戳根据量级自动识别毫秒或微秒，并转为不带时区的 UTC DuckDB `TIMESTAMP`。输出使用 ZSTD 压缩，按 `year/month` 分区。

### `binance-trades` 与 `binance-agg-trades`

来自 `data.binance.vision` 的 Binance 批量逐笔档案，可以是 ZIP，也可以是解压后的裸 CSV：

| 数据集      | 配置                 | 内容                           |
| ----------- | -------------------- | ------------------------------ |
| `trades`    | `binance-trades`     | 每一笔成交                     |
| `aggtrades` | `binance-agg-trades` | 按价格、订单、时间合并后的成交 |

必须提供 `market=spot|um` 和 `symbol`。`interval` 与 `hasHeader` 会被拒绝：表头由市场推导，因为 Spot 档案没有表头行、USD-M 档案有。列名也按市场不同（`tradeId`/`quoteQty` 对 `id`/`quote_qty`，`qty` 对 `quantity`，`time` 对 `transact_time`）。四种布局都会映射到同一套列。

- 时间戳：Spot 档案自 2025-01-01 起为微秒，之前为毫秒；USD-M 档案为毫秒。按量级自动识别，统一归一为与 K 线相同的不带时区 UTC `TIMESTAMP`。
- USD-M 不发布 `is_best_match`，该列为 NULL。
- **`aggtrades` 的 `quote_qty` 为 NULL。** Binance 不为聚合成交发布报价量，因此该列留空，而不是填入派生值；聚合查询改用 `price * qty` 计算 `quoteVolume` 与 `vwap`。
- 路径中不出现 `interval`。布局为 `dataset=<trades|aggtrades>/source=<source>/market=<spot|um>/symbol=<SYMBOL>/import=<uuid>/year/month`。

去重键为 `(market, trade_id)` 或 `(market, agg_trade_id)`。市场是键的一部分，因为 Spot 与 USD-M 的成交编号互相独立：同一个 ID 在两个市场都存在，只按 ID 去重会静默丢掉一半数据。

四种布局的列数互不相同（Spot trades 7 列、USD-M trades 6 列、Spot aggTrades 8 列、USD-M aggTrades 7 列），因此把文件导入到错误的 `market` 会因列数不符而报错，而不是存进错误的数据。

### 查询逐笔数据

`warehouse_query_trades` 必须提供 `market`，有两种形态：

- **行级**（默认）：返回最多 `limit` 条去重后的记录，最新在前。
- **聚合**：设置 `bucketSeconds`，每个时间桶返回一行，包含 `tradeCount`、`volume`、`quoteVolume`、`vwap`、`takerBuyVolume`、`takerSellVolume`、`takerImbalance` 以及 `open`/`high`/`low`/`close`。此时 `limit` 是桶数上限，超限会直接报错，而不是静默截断。

行级查询上限 5000 条，对活跃交易对不足一秒行情；更宽的窗口请使用 `bucketSeconds`。`takerBuyVolume` 统计的是 `is_buyer_maker` 为 false 的记录，即主动方为买方。

分桶结果还包含 `taker_delta`（主动买减主动卖）与 `cvd`（该差值在结果集内的累计和）。**CVD 锚定在查询窗口的起点**，不是锚定到某个交易时段或自然日：同一个桶在 `startTime` 不同时 CVD 值不同，因此**不能跨窗口比较**。

订单流复盘有三个可选参数：

| 参数                    | 适用模式   | 含义                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minNotional`           | 行级、分桶 | 定义"什么算大单"，口径为 `price * qty`。行级查询只返回达到阈值的成交；分桶查询**保留全量**，只把结果填进 `large_trade_count` / `large_trade_notional`——分桶时它刻意不过滤，否则会静默改写 `tradeCount`、`volume` 与 `vwap` 的含义。缺省为 0。                                                                                   |
| `minSpan`               | 仅行级     | 定义"什么算扫单"：一张主动单至少要吃掉多少档挂单。**仅 aggtrades**——原始 trades 每行就是一档，没有 span 概念。                                                                                                                                                                                                                  |
| `minPrice` / `maxPrice` | 全部模式   | 价格区间。与 `minNotional` 不同，这是**范围**而非定义，因此在所有模式下生效：分桶与价位结果都只描述区间内的成交。给出基于该区间的任何结论时都必须同时给出区间。                                                                                                                                                                 |
| `groupBy=price`         | 仅分桶     | Footprint 视图：每个价位一行，含主动买/卖拆分、净 `delta`、`volume`、`trade_count` 与该价位被击中的时间跨度。必须同时提供 `bucketSeconds` **以及 `startTime` 和 `endTime`**——无边界的时间范围会在行数上限生效前先读完整个历史。会拒绝 `minNotional`（会扭曲价位分布），并按成交量排序，使流动性密集的价位在触达上限时仍能保留。 |

对当前模式没有意义的过滤条件会被**拒绝**而不是忽略，避免把静默失效误当成过滤生效。分桶结果中的报价量与 VWAP 由 `price * qty` 派生，因为聚合成交不携带报价量。

### `binance-metrics` 与 `binance-book-depth`

两个仅 USD-M 的快照序列，Binance 对两者都没有 Spot 版本。

| 数据集      | 配置                 | 粒度   | 内容                                                                        |
| ----------- | -------------------- | ------ | --------------------------------------------------------------------------- |
| `metrics`   | `binance-metrics`    | 5 分钟 | 持仓量、持仓名义额、大户与全体账户多空比、主动买卖量比                      |
| `bookdepth` | `binance-book-depth` | 30 秒  | 有符号百分比档位（−5、−4、−3、−2、−1、−0.2 及正值镜像）内的累计深度与名义额 |

必须提供 `market=um` 和 `symbol`。**`bookdepth` 不是逐档盘口**——它回答的是"±X% 范围内累计有多少深度"，不是"买一挂了多少"；逐档最优挂单档案已于 2024 年初停更。

用 `warehouse_query_series` 查询：

```text
调用 warehouse_query_series，dataset=metrics，symbol=BTCUSDT，
startTime=2026-08-01T00:00:00Z，endTime=2026-08-01T06:00:00Z。
调用 warehouse_query_series，dataset=bookdepth，symbol=BTCUSDT，percentage=-0.2，
bucketSeconds=300，limit=100。
```

设置 `bucketSeconds` 会把每个数值列按桶求平均；bookdepth 会把 `percentage` 档位作为独立的分组键保留，因此聚合**不会跨档位平均**。`percentage` 用于选择单个档位，对 `metrics` 传入会被拒绝。两个数据集都很小：bookdepth 约 12 MB/（交易对·月），metrics 约 0.2 MB。

### `generic-csv`

默认第一行是表头；无表头时传 `hasHeader=false`。DuckDB 自动推断列名与类型，系统只附加 `_warehouse_import_id` 和 `_warehouse_imported_at`。此配置适合先保存来自其他平台的原始导出；当前不会把它强行转换为 Kline 标准列，因此不能通过 `warehouse_query_candles` 查询。

### `parquet`

读取现有 Parquet 并复制到受管仓库，同时附加审计列。它不改写业务列，也不会自动视为 Kline 数据。

## MCP 使用示例

先把本地文件放进 `H:\marketData\imports`，然后发送：

```text
调用 binance-research-pro 的 warehouse_import_file：
path=H:\marketData\imports\BTCUSDT-1h-2025-01.zip
dataset=candles
source=binance-public-data
profile=binance-kline
market=spot
symbol=BTCUSDT
interval=1h
expectedSha256=<可选的64位SHA-256>
```

直接导入官方 HTTPS 文件：

```text
调用 warehouse_import_url，url=<官方 ZIP URL>，dataset=candles，
source=binance-public-data，profile=binance-kline，market=um，
symbol=BTCUSDT，interval=1h。
```

检查和查询：

```text
调用 warehouse_status。
调用 warehouse_list_datasets。
调用 warehouse_data_range，dataset=candles，source=binance-public-data，
market=spot，symbol=BTCUSDT，interval=1h。
调用 warehouse_query_candles，参数同上，
startTime=2025-01-01T00:00:00Z，endTime=2025-01-31T23:59:59Z，limit=500。
```

查询结果按 `open_time` 倒序。若多个导入包含同一根 K 线，保留导入时间最新的记录。

逐笔档案使用同样的工具，只是选择参数不同：

```text
调用 warehouse_import_url，url=<官方日级逐笔 ZIP URL>，
dataset=aggtrades，source=binance-public-data，profile=binance-agg-trades，
market=spot，symbol=BTCUSDT，expectedSha256=<64位SHA-256>。
调用 warehouse_data_range，dataset=aggtrades，market=spot，symbol=BTCUSDT，
startTime=2026-08-01T00:00:00Z，endTime=2026-08-01T23:59:59Z。
调用 warehouse_query_trades，dataset=aggtrades，market=spot，symbol=BTCUSDT，
startTime=2026-08-01T00:00:00Z，endTime=2026-08-01T01:00:00Z，
bucketSeconds=60，limit=120。
```

逐笔导入不要传 `interval`。不要导入当天或前一天的 UTC 日文件：Binance 可能重发这些文件，而重发的档案是合并而不是替换。

`warehouse_data_range` 对逐笔数据集接受 `startTime` 与 `endTime`，它也是本工具中唯一**开销随仓库历史增长、而非随查询增长**的查询：不给时间范围就会读该 symbol 生成过的每一个文件。除非确实需要完整跨度，请传时间范围。K 线分支保持原有契约，会拒绝这两个时间参数。

**时间范围只用于挑选文件，不用于过滤行。** Binance 的逐笔档案按天发布，因此针对日级文件查询一个小时的窗口，仍然会读取并返回**整天**的数据。返回的 `minEventTime` 与 `maxEventTime` 是**文件**的边界，而不是你请求的窗口边界：请求 1 小时通常会得到 24 小时的时间跨度。请把时间范围当作成本控制手段，精确的时间边界交给 `warehouse_query_trades`；范围查询回答的是"哪些天存在"，而不是"01:00 到 02:00 之间发生了什么"。

范围查询只返回最早与最晚时间，**无法判断中间的日期是否齐全**——缺一天的窗口看起来仍是连续的。请改用 `warehouse_coverage`：它基于文件边界统计**不同的 UTC 天数**、返回缺失的日期，且不读取任何 parquet 数据，因此开销足够低，可以在每次多日分析前先跑一次。该工具对逐笔数据集要求传 `market`，因为现货与 U 本位是两组独立文件，不能合并统计。

## 安全与运维

- 本地文件必须位于白名单根目录内，检查会解析符号链接和 Windows junction。
- URL 只允许 HTTPS，不允许凭据；每次重定向都会重新校验，每个 HTTPS 连接都绑定到已校验的公网地址。
- 下载、输入文件和 ZIP 流式解压都受 `WAREHOUSE_MAX_IMPORT_BYTES` 限制。
- 导入在一个进程内串行执行。不要启动多个写进程同时使用同一元数据数据库。
- 删除或移动 Parquet 文件不会自动修改元数据；查询会跳过已不存在的文件，运维时应同步管理目录与数据库。
- `generic-csv` 使用自动类型推断。长期稳定的数据集应在后续版本增加显式导入配置和清洗测试。
