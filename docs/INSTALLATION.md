# Installation and maintenance

## 1. Authenticate npm

Both plugins download a private GitHub Packages artifact. Configure each host without committing the token:

```powershell
npm config set @steveyangpi:registry https://npm.pkg.github.com
npm login --scope=@steveyangpi --auth-type=legacy --registry=https://npm.pkg.github.com
```

Use your GitHub username and a classic personal access token with `read:packages`. Repository access is also required because the package is private. Verify the package pinned by both plugin adapters:

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@0.4.5 -- binance-research-pro-mcp
```

The command is a stdio server and normally waits silently for JSON-RPC input; stop it with Ctrl+C.

## 2. Install the Codex plugin

For a Personal marketplace, make the plugin source resolve to:

```text
C:\Users\<you>\plugins\binance-research-pro
```

That path may be a junction to this repository root. Register it in the Personal marketplace with the Codex plugin development workflow, install `binance-research-pro`, then fully restart Codex and start a new task.

## 3. Load the Claude Code plugin locally

Use the repository root as the plugin directory so Claude Code can read `.claude-plugin/plugin.json`, the shared `skills/` directory, and `claude.mcp.json`:

```powershell
claude --plugin-dir .
```

Validate the same directory before relying on it:

```powershell
npm run check:claude-plugin
```

### Install via Claude Code Marketplace

The repository ships `.claude-plugin/marketplace.json` so the plugin can be discovered and installed from a GitHub marketplace instead of a local path:

```powershell
claude plugin marketplace add steveyangpi/binance-research-pro
claude plugin install binance-research-pro@binance-research-pro-marketplace
```

The marketplace points at this repository root, so the installed plugin uses the same `.claude-plugin/plugin.json`, `skills/`, and `claude.mcp.json`. Because the MCP server is a private GitHub Packages artifact, each host still needs the npm registry authentication from section 1.

Never register `packages/mcp` as a plugin source. The manifests and client-specific MCP adapters live at the repository root.

## 4. Configure optional host state

Configuration values remain host-owned. Codex forwards the optional names declared in `.mcp.json`; Claude Code inherits the host process environment through `claude.mcp.json`. Neither file contains values. For example:

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_RESEARCH_DATA_DIR',
  'D:\marketData',
  'User'
)
```

Restart the active client after changing variables. See `packages/mcp/docs/ENVIRONMENT.md` for all settings.

Optional account research uses `BINANCE_ACCOUNT_PROFILES_PATH` and an external protected Ed25519 profile file. Never put its values in this repository. Follow `ACCOUNT-ACCESS.md` and restart the active client after configuration.

## 5. Acceptance checks

- request a current Spot comparison;
- request a USD-M funding/basis summary;
- inspect local warehouse status;
- call `account_profiles_status`; it should report unconfigured unless a protected profile was intentionally added;
- confirm no order placement, cancellation, leverage-change, transfer, or withdrawal tool is present.

Remove any legacy standalone `binance-analysis` user MCP entry only after these checks pass, otherwise tools may appear twice.

## Updating

Do not edit files inside an installed plugin cache. Update this source repository, run validation, publish and verify the referenced MCP package, then update both plugin adapters during Stage 2. The exact sequence is in `RELEASING.md`.
