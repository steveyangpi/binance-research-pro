# Development

## Setup

```powershell
git clone https://github.com/steveyangpi/binance-research-pro.git
cd binance-research-pro
npm install
npm run check
```

Node.js 22.13+, npm, and Python 3 are required. The workspace lockfile at the repository root is authoritative.

## Common commands

```powershell
npm run dev:mcp
npm run test
npm run test:mcp
npm run test:mcp:live
npm run test:package
```

`test:mcp` is deterministic and does not call Binance. `test:mcp:live` calls the configured public endpoints and should not be required in offline CI.

## Change rules

- MCP implementation changes belong in `packages/mcp`.
- Tool contract changes also require Skill and smoke-test updates.
- Codex manifest changes require a cachebuster bump before reinstalling; Claude Code manifest changes require plugin validation before reloading.
- Do not put machine-specific paths, access tokens, or `.npmrc` credentials in the repository.
- Keep generated `dist`, caches, warehouse data, and local environment files untracked.

## Local plugin development

The Codex Personal Marketplace source and the Claude Code local plugin directory can both point to this repository root. Their adapters launch the same published package from `.mcp.json` and `claude.mcp.json`; use `npm run dev:mcp` when debugging MCP source directly. After a plugin change, follow the client-specific reload steps in `docs/INSTALLATION.md` and run `npm run check:claude-plugin` before loading the Claude Code adapter.
