# Installation and maintenance

## 1. Authenticate npm

The plugin downloads a private GitHub Packages artifact. Configure each host without committing the token:

```powershell
npm config set @steveyangpi:registry https://npm.pkg.github.com
npm login --scope=@steveyangpi --auth-type=legacy --registry=https://npm.pkg.github.com
```

Use your GitHub username and a classic personal access token with `read:packages`. Repository access is also required because the package is private. Verify the package pinned in `.mcp.json`:

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@0.4.3 -- binance-research-pro-mcp
```

The command is a stdio server and normally waits silently for JSON-RPC input; stop it with Ctrl+C.

## 2. Register and install the plugin

For a Personal marketplace, make the plugin source resolve to:

```text
C:\Users\<you>\plugins\binance-research-pro
```

That path may be a junction to this repository root. Register it in the Personal marketplace with the Codex plugin development workflow, install `binance-research-pro`, then fully restart Codex and start a new task.

Never register `packages/mcp` as the plugin source. The manifest lives at the repository root.

## 3. Configure optional host state

`.mcp.json` forwards optional variable names but does not contain their values. For example:

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_RESEARCH_DATA_DIR',
  'D:\marketData',
  'User'
)
```

Fully restart Codex after changing variables. See `packages/mcp/docs/ENVIRONMENT.md` for all settings.

Optional account research uses `BINANCE_ACCOUNT_PROFILES_PATH` and an external protected Ed25519 profile file. Never put its values in this repository. Follow `ACCOUNT-ACCESS.md` and restart the app after configuration.

## 4. Acceptance checks

- request a current Spot comparison;
- request a USD-M funding/basis summary;
- inspect local warehouse status;
- call `account_profiles_status`; it should report unconfigured unless a protected profile was intentionally added;
- confirm no order placement, cancellation, leverage-change, transfer, or withdrawal tool is present.

Remove any legacy standalone `binance-analysis` user MCP entry only after these checks pass, otherwise tools may appear twice.

## Updating

Do not edit files inside the installed plugin cache. Update this source repository, run validation, bump the plugin cachebuster, and reinstall from the Personal marketplace after the referenced MCP package has been published. The exact sequence is in `RELEASING.md`.
