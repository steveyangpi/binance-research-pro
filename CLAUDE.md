# CLAUDE.md

This repository implements the stdio MCP backend used by the sibling `H:\Code\binance-research-pro` plugin.

Read `CODEX.md`, `docs/ARCHITECTURE.md`, and relevant service/tool files before editing. Preserve the public-data-only phase-1 boundary. Never add Binance credentials to configuration, source, logs, tests, or documentation.

Keep calculations in services, HTTP normalization in `src/binance`, MCP contracts in `src/mcp`, and persistent history in `src/warehouse`. Tool changes must be reflected in the sibling plugin Skills.

Run `npm run format`, `npm run check`, and `npm run test:mcp` before handoff.
