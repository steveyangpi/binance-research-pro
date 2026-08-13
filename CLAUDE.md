# CLAUDE.md

## Project

Binance Research Pro is a private monorepo. The repository root is a Codex plugin; `packages/mcp` is the TypeScript MCP server published to GitHub Packages as `@steveyangpi/binance-research-pro-mcp`.

## Safety boundary

- Use Binance public Spot and USD-M Futures data only.
- Never add API-key, account, order, transfer, or withdrawal capabilities.
- Keep market claims timestamped and distinguish live API data from the local warehouse.
- Warehouse imports are state-changing. Reads are the default; imports require an explicit source.

## Repository rules

- Do not hard-code a checkout path in `.mcp.json` or generated launchers.
- Keep the MCP package private and pin the installed plugin to an exact published version.
- A source version may be newer than the plugin pin while a release is being prepared. Publish the package first, then update `.mcp.json`.
- When MCP tool names, schemas, or semantics change, update affected Skills and tests in the same change.
- Preserve the stdio protocol: diagnostic output belongs on stderr, never stdout.
- Update English and Simplified Chinese documentation together.

## Commands

```bash
npm install
npm run check
npm run test:package
npm run test:mcp:live   # requires live Binance access
```

Before publishing the MCP package, run `npm run release:check`. Before shipping a plugin that pins the new package, run `npm run plugin:release-check`.

## Important paths

- `.codex-plugin/plugin.json`: plugin manifest and cachebuster version
- `.mcp.json`: portable runtime command and environment-variable allowlist
- `skills/`: research workflows
- `packages/mcp/src/`: MCP implementation
- `packages/mcp/tests/`: unit and integration tests
- `scripts/validate.py`: dependency-free cross-deliverable validation
- `docs/RELEASING.md`: two-phase release procedure
