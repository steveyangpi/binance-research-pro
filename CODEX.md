# Binance Analysis MCP — Agent Guide

This TypeScript project is the data and deterministic-computation backend for `H:\Code\binance-research-pro`.

## Phase-1 boundary

- Binance public Spot and USD-M Futures data only.
- No API key, account, position, order, transfer, or withdrawal capability.
- SQLite stores public response cache entries; DuckDB/Parquet stores imported history.

## Change rules

- Keep stdout reserved for MCP protocol traffic; logs go to stderr.
- Validate tool inputs with Zod and normalize external payloads before exposing them.
- Public API tools are read-only, non-destructive, idempotent, and open-world.
- Warehouse imports are state-changing; remote imports are open-world.
- Reflect tool changes in the sibling plugin Skills and documentation.

## Quality gate

```powershell
npm run format
npm run check
npm run test:mcp
```
