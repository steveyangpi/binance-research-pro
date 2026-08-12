# Architecture and conventions

[简体中文](ARCHITECTURE.zh-CN.md)

## Layers

```text
src/index.ts                Composition root: creates the server and transport
src/mcp/                    MCP tools, input schemas, and protocol results
src/services/               Market analysis and indicator calculations
src/binance/                Separate Spot/Futures HTTP clients and response normalization
src/cache/                  Persistent SQLite and fallback in-memory caches
src/warehouse/              Parquet imports, DuckDB queries, SQLite metadata, path safety
src/types/                  Internal normalized types for external data
scripts/mcp-smoke-test.mjs  MCP handshake and optional live-call test
```

The tool layer never makes HTTP requests directly, and raw Binance payloads are not exposed without normalization. Numeric fields are converted to `number` at the API boundary, while the analysis layer depends only on normalized domain types such as `BinanceKline`.

## Data flow

```text
MCP Client -> MCP tool + Zod validation -> Spot/Futures analysis service
           -> TTL cache -> Spot/Futures API client -> Binance REST APIs
           <- normalized domain data <- indicator calculations

MCP client -> warehouse tool -> serialized import queue -> CSV/ZIP/Parquet
           -> DuckDB conversion -> year/month Parquet partitions
           -> SQLite metadata, checksums, and import state
```

## Conventions

- TypeScript `strict` is enabled, implicit `any` is prohibited, and ESM imports use explicit `.js` suffixes.
- Every tool argument is validated with Zod; symbols are normalized to uppercase.
- stdout is reserved for MCP protocol messages. Future logs must use stderr and must never contain secrets.
- Public market data uses a short TTL cache. Authenticated account or trading modules must not reuse the unauthenticated client.
- Spot and USD-M Futures use separate base URLs, clients, cache namespaces, and MCP tool names.
- Indicator results should include their parameters, data timestamp, and a non-investment-advice notice.
- Generic sources use import profiles rather than platform API adapters; V1 does not perform complex cleaning or cross-platform semantic mapping.

## Local storage

`SqliteCache` stores normalized public API responses as JSON in `cache_entries`. Each row contains a namespaced key, payload, expiration time, and update time. WAL mode allows safe access by local MCP processes. Expired rows are removed on read and periodically on write; when the configured capacity is exceeded, the oldest rows are removed.

The database contains public market data only. API credentials, prompts, model responses, and account data are never stored. `TtlCache` remains available when persistent caching is disabled.

### Historical warehouse

`WarehouseService` owns generic file import and DuckDB queries. `WarehouseMetadataStore` records jobs, provenance, SHA-256, ranges, and Parquet paths. Klines use a stable schema and the hierarchy `dataset/source/market/symbol/interval/import/year/month`. Queries select files from metadata, then use DuckDB projection, filtering, and `open_time` deduplication.

Writes are serialized inside one MCP process. A deployment should still have only one warehouse writer; separate readers may share Parquet but should not concurrently modify the metadata database. Partition values use a safe character set, local files must be under `WAREHOUSE_IMPORT_ROOTS`, and downloads enforce HTTPS, redirect/address validation, maximum size, and timeout.

## Code-review findings and known boundaries

- The MCP, HTTP, analysis, and cache responsibilities are cleanly separated; input schemas and Binance response normalization are placed appropriately.
- Trend labels currently use one timeframe and are not trading signals.
- Persistent cache capacity and TTL values are configurable; different request shapes remain separate cache keys.
- RSI currently returns 100 for a completely flat series; 50 is a more common convention, so this needs an edge-case fix and test.
- Calling `market_overview` without a symbol fetches the complete 24-hour ticker list; clients should avoid high-frequency calls.
- A future WebSocket depth implementation must validate snapshot/event ordering and handle connection rotation and reconnection.
