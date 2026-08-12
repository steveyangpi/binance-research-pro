# 架构与代码规范

[English](ARCHITECTURE.md)

## 分层

```text
src/index.ts                组合根：创建 Server 与 transport
src/mcp/                    MCP 工具定义、输入 Schema、协议输出
src/services/               市场分析与指标计算
src/binance/                独立 Spot/Futures HTTP 客户端与响应转换
src/cache/                  SQLite 持久化缓存与内存回退缓存
src/warehouse/              Parquet 导入、DuckDB 查询、SQLite 元数据与路径安全
src/types/                  外部数据的内部标准化类型
scripts/mcp-smoke-test.mjs  MCP 协议握手与可选实时调用测试
```

工具层不直接发 HTTP 请求；Binance 响应不会未经转换直接暴露给调用方。所有数值在 API 边界转为 `number`，分析层只依赖 `BinanceKline` 等标准化领域类型。

## 数据流

```text
MCP Client -> MCP tool + Zod validation -> Spot/Futures 分析服务
           -> TTL cache -> Spot/Futures API 客户端 -> Binance REST API
           <- normalized domain data <- indicator calculations

MCP Client -> 仓库工具 -> 串行导入队列 -> CSV/ZIP/Parquet
           -> DuckDB 转换 -> 年/月 Parquet 分区
           -> SQLite 元数据、校验和与导入状态
```

## 代码规范

- 启用 TypeScript `strict`，禁止隐式 `any`，ESM 导入显式使用 `.js` 后缀。
- 所有工具参数必须经过 Zod 校验；交易对统一转为大写。
- stdout 仅用于 MCP 协议；新增日志时必须使用 stderr，且不得记录密钥。
- 公共市场数据使用短 TTL 缓存；真实交易或账户模块不得与无鉴权客户端混用。
- Spot 和 USDⓈ-M Futures 使用独立的基础地址、客户端、缓存命名空间和 MCP 工具名。
- 指标输出必须携带计算参数、数据时间和非投资建议声明。
- 通用数据源使用导入配置而不是平台 API 适配器；首版不承担复杂清洗和跨平台语义映射。

## 本地存储

`SqliteCache` 将标准化后的公共 API 响应以 JSON 形式存入 `cache_entries`。每条记录包含带命名空间的键、响应内容、过期时间和更新时间。数据库启用 WAL 模式，支持本地 MCP 进程安全访问。读取时删除过期记录，写入时定期清理；超过配置容量后删除最旧记录。

数据库只保存公开市场数据，不保存 API 密钥、提示词、模型回答或账户数据。关闭持久化缓存时使用 `TtlCache` 作为内存回退。

### 历史数据仓库

`WarehouseService` 管理通用文件导入和 DuckDB 查询，`WarehouseMetadataStore` 仅保存任务、来源、SHA-256、数据范围和 Parquet 文件目录。Kline 采用一致列类型并按 `dataset/source/market/symbol/interval/import/year/month` 组织；查询基于元数据选择文件，再由 DuckDB 投影、过滤并按 `open_time` 去重。

单个 MCP 进程内的写入通过 Promise 队列串行化。部署时也应只保留一个仓库写进程；其他进程可只读共享 Parquet，但不应同时修改同一元数据数据库。路径分区值只允许安全字符，本地文件必须位于 `WAREHOUSE_IMPORT_ROOTS`，下载只允许 HTTPS 并限制重定向、目标地址、文件大小和超时。

## Code review 结论与已知边界

- MCP、HTTP、分析和缓存职责分离清晰；输入 Schema 与 Binance 响应归一化位置合理。
- 当前趋势结论仅使用一个时间周期，不等同于交易信号。
- 持久化缓存的容量与 TTL 均可配置；不同请求参数仍使用独立缓存键。
- RSI 在完全无涨跌的序列上当前返回 100；更常见的约定是 50，应修正并增加边界测试。
- `market_overview` 在未指定交易对时会请求完整 24 小时 ticker 列表，调用方应避免高频执行。
- 后续 WebSocket 深度实现必须校验快照和增量事件的顺序，并处理连接轮换和重连。
