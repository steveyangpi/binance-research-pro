# Binance Research Pro

[简体中文](README.zh-CN.md)

Binance Research Pro is a private monorepo containing:

- a Codex plugin at the repository root;
- the publishable `@steveyangpi/binance-research-pro-mcp` stdio server in `packages/mcp`.

The project researches Binance Spot and USD-M Futures public market data, maintains an optional local DuckDB/Parquet history warehouse, and can opt into isolated Ed25519 `USER_DATA` profiles for read-only account research. It has no order execution, leverage-change, transfer, or withdrawal capability.

## Why one repository

Plugin Skills, MCP tool schemas, tests, and documentation evolve together. Keeping them in one repository makes an incompatible change visible in one review and allows CI to validate both deliverables. Runtime deployment remains decoupled: the plugin launches a pinned private GitHub Packages version instead of a source-tree path.

## Repository map

```text
.codex-plugin/plugin.json       Codex plugin manifest
.mcp.json                       Portable, pinned MCP launch configuration
skills/                         Spot, derivatives, history, and risk workflows
packages/mcp/                   TypeScript MCP npm workspace
scripts/                        Cross-deliverable validation
docs/                           Architecture, development, release, and security
.github/workflows/              CI and manual private-package publishing
```

## Requirements

- Node.js 22.13 or newer and npm.
- Python 3 for the dependency-free plugin validator.
- GitHub Packages read access for `@steveyangpi` when running the installed plugin.
- Network access to Binance endpoints used by the selected public or read-only account research.

Public research needs no Binance credential. Optional account reads use a protected profile file outside the repository; see [Read-only account access](docs/ACCOUNT-ACCESS.md). Never paste credentials into ChatGPT, Codex, source files, logs, or issues.

## Development quick start

```powershell
git clone https://github.com/steveyangpi/binance-research-pro.git
cd binance-research-pro
npm install
npm run check
npm run test:package
```

`npm run check` validates formatting, lint, TypeScript, unit tests, an MCP handshake, the plugin package, and the staged release state. `npm run test:package` performs `npm pack`, installs the tarball in an isolated consumer, and handshakes with that installed package.

Live Binance validation is explicit:

```powershell
npm run test:mcp:live
```

## Runtime model

The plugin launches the fixed private package declared in [.mcp.json](.mcp.json). Optional host settings such as `BINANCE_RESEARCH_DATA_DIR` are forwarded by name through `env_vars`; their values stay on each host.

`BINANCE_ACCOUNT_PROFILES_PATH` can point to an external credentials file containing multiple isolated Spot or USD-M read-only profiles. Private account responses are never written to the market cache or historical warehouse.

Default data locations are OS-specific. Set one root to move all cache and warehouse state:

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_RESEARCH_DATA_DIR',
  'H:\marketData',
  'User'
)
```

Fully restart Codex after changing a forwarded host variable.

## Change and release policy

1. Change MCP implementation and tests in `packages/mcp`.
2. Update affected Skills and documentation in the same change.
3. Run `npm run release:check`.
4. Publish a new immutable MCP package version.
5. Verify the registry package in a clean environment.
6. Pin that version in `.mcp.json`, update the plugin cachebuster, and reinstall the plugin.

Never point the installed plugin at a repository `dist/index.js` path. See [Development](docs/DEVELOPMENT.md), [Releasing](docs/RELEASING.md), [Architecture](docs/ARCHITECTURE.md), and [Security](docs/SECURITY.md).

## Research boundary

Results are descriptive market research, not personalized financial advice. Verify data freshness, exchange rules, regional availability, liquidity, and volatility before relying on any result.
