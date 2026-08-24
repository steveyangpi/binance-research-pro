# Testing

## Required local gate

From the monorepo root:

```powershell
npm ci
npm run check
npm run test:package
```

The gate covers repository formatting, ESLint, TypeScript, unit tests, deterministic MCP handshakes, every exposed tool's schema and safety annotations, canonical Skill-to-tool references, both Plugin structures, normal release-state validation, tarball contents, isolated installation, and a handshake through the installed CLI. The default handshake deliberately removes `BINANCE_ACCOUNT_PROFILES_PATH`, so a developer's real profile cannot make the test environment-dependent.

For Claude Code manifest acceptance, run:

```powershell
npm run check:claude-plugin
```

The repository-root `CLAUDE.md` remains project context rather than plugin context, so Claude Code reports that expected warning; the dependency-free validator enforces the plugin manifest fields used by this project. CI runs `check` and `test:package` on Linux and Windows, and installs the pinned Claude Code CLI on Linux to run this native validation.

Account unit tests use generated keys and synthetic responses. They verify the signed-origin allowlist, redirect rejection, lossless large integer parsing, exact decimal output, and zero-balance/flat-position filtering without using a real credential.

## Optional live gate

```powershell
npm run test:mcp:live
```

This calls Binance public endpoints. Record the endpoint, time, and regional/network limitations when reporting a failure. It is intentionally excluded from offline CI.

Authenticated live tests are separate and manual. Use a newly created read-only Ed25519 profile outside the repository. Never place its files or values in CI. Start with `account_profiles_status`, then call only the surface-specific read that the profile declares.

The manual publish workflow installs the exact registry artifact into an isolated temporary consumer in a separate `packages: read` job. Install scripts are disabled, and registry tokens are removed before the installed MCP CLI is started.

## Plugin acceptance

- Spot single-symbol and multi-symbol prompts select the intended tools.
- Multi-timeframe analysis reports interval-specific evidence.
- Futures output keeps mark/index price, basis, funding, open interest, and trend distinct.
- Historical research checks warehouse coverage before querying or importing.
- Imports are treated as state-changing and require an explicit source.
- Responses report freshness and limitations.
- Account tools remain discoverable without credentials and report an unconfigured status safely.
- Configured account reads select the intended profile and private responses are not cached.
- Trading, cancellation, leverage-change, transfer, and withdrawal requests are clearly unsupported.

Before stage-two release, `npm run plugin:release-check` must also prove that both MCP configurations pin the current source package version.
