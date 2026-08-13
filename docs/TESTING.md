# Testing

## Required local gate

From the monorepo root:

```powershell
npm ci
npm run check
npm run test:package
```

The gate covers repository formatting, ESLint, TypeScript, unit tests, a deterministic MCP handshake and tool-schema check, plugin structure, release-state validation, tarball contents, isolated installation, and a handshake with the installed package.

## Optional live gate

```powershell
npm run test:mcp:live
```

This calls Binance public endpoints. Record the endpoint, time, and regional/network limitations when reporting a failure. It is intentionally excluded from offline CI.

## Plugin acceptance

- Spot single-symbol and multi-symbol prompts select the intended tools.
- Multi-timeframe analysis reports interval-specific evidence.
- Futures output keeps mark/index price, basis, funding, open interest, and trend distinct.
- Historical research checks warehouse coverage before querying or importing.
- Imports are treated as state-changing and require an explicit source.
- Responses report freshness and limitations.
- Account and trading requests are clearly unsupported.

Before stage-two release, `npm run plugin:release-check` must also prove that `.mcp.json` pins the current source package version.
