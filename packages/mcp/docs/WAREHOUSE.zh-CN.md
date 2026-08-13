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
```

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

必须提供 `symbol` 和 `interval`，建议同时提供 `market=spot|um|cm`。时间戳根据量级自动识别毫秒或微秒，并转为 DuckDB `TIMESTAMP`。输出使用 ZSTD 压缩，按 `year/month` 分区。

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

## 安全与运维

- 本地文件必须位于白名单根目录内，检查会解析符号链接和 Windows junction。
- URL 只允许 HTTPS，不允许凭据；每次重定向都会重新校验，并拒绝解析到本机或私网的地址。
- 下载、输入文件和 ZIP 解压后的 CSV 都受 `WAREHOUSE_MAX_IMPORT_BYTES` 限制。
- 导入在一个进程内串行执行。不要启动多个写进程同时使用同一元数据数据库。
- 删除或移动 Parquet 文件不会自动修改元数据；查询会跳过已不存在的文件，运维时应同步管理目录与数据库。
- `generic-csv` 使用自动类型推断。长期稳定的数据集应在后续版本增加显式导入配置和清洗测试。
