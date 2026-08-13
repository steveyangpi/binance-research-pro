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
- Plugin metadata or Skill changes normally require a plugin cachebuster bump before reinstalling.
- Do not put machine-specific paths, access tokens, or `.npmrc` credentials in the repository.
- Keep generated `dist`, caches, warehouse data, and local environment files untracked.

## Local plugin development

The personal marketplace source can point to this repository root. The plugin itself still launches the published package from `.mcp.json`; use `npm run dev:mcp` when debugging MCP source directly. After a plugin change, use the Codex plugin development reinstall/cachebuster workflow described in `docs/INSTALLATION.md`.
