# Releasing

Binance Research Pro releases the private MCP package first, then the Codex and Claude Code plugin adapters that pin it. Push and pull-request CI only validate; publishing is manual through **Publish private MCP package** (`workflow_dispatch`). Never publish this package to public npm or a public marketplace.

## Version and Git contract

A formal release has one product version, `X.Y.Z`:

| Surface                                      | Required value                                |
| -------------------------------------------- | --------------------------------------------- |
| Root workspace and lockfile                  | `X.Y.Z`                                       |
| MCP package and workspace lockfile entry     | `X.Y.Z`                                       |
| Codex and Claude MCP exact package pins      | `@steveyangpi/binance-research-pro-mcp@X.Y.Z` |
| Claude Code Plugin manifest                  | `X.Y.Z`                                       |
| Current installation and connection examples | the same exact pin                            |
| Final annotated Git tag                      | `vX.Y.Z`                                      |
| Codex Plugin manifest                        | `X.Y.Z+codex.YYYYMMDDHHmmss`                  |

The 14-digit Codex suffix is a UTC deployment revision, not another product version. Use standard prereleases such as `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, and `X.Y.Z-rc.N` only during development. Until Stage 2, source may lead both installed Plugin pins; never point either MCP configuration at unpublished source.

## Stage 1: publish and verify the private MCP package

1. Choose the next `X.Y.Z`, update the root workspace and `packages/mcp` package versions, and regenerate the root lockfile with npm. Update implementation, tests, canonical Skills, package READMEs, and English/Simplified Chinese documentation together.
2. Confirm `publishConfig` still targets `https://npm.pkg.github.com` with `access: restricted`. Do not add credential values, private account responses, runtime data, public registry publication, trading, leverage changes, transfers, or withdrawals.
3. Run:

```powershell
npm ci
npm run release:check
npm run test:package
npm pack --workspace packages/mcp --dry-run
```

4. Inspect the pack output: it must contain no secrets, local warehouse/runtime data, or monorepo-only files.
5. From an authorized GitHub Packages publishing environment, run the manual **Publish private MCP package** workflow. GitHub Packages versions are immutable; preflight must reject an existing version. The workflow publishes in a `packages: write` job, then verifies the exact registry artifact in a separate `packages: read` job.
6. Confirm the `verify-published` job installs the package into an isolated temporary consumer with lifecycle scripts disabled, removes registry credentials, and starts the absolute installed CLI successfully. An additional clean, authenticated host can validate the same command shape as `.mcp.json`:

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@X.Y.Z -- binance-research-pro-mcp
```

Record a successful CLI/MCP stdio handshake from the workflow before proceeding. Stage 2 is blocked until this check passes.

At this point both MCP configurations may still pin the previous package. This is expected and keeps installed Plugins working during publication.

## Stage 2: release both plugin adapters

1. Update `.mcp.json` and `claude.mcp.json` to the verified exact package version.
2. Update `.claude-plugin/plugin.json` to `X.Y.Z` and `.codex-plugin/plugin.json` to `X.Y.Z+codex.YYYYMMDDHHmmss`, using a new UTC Codex deployment revision.
3. Update every current installation/connection example in English and Simplified Chinese. `npm run plugin:release-check` validates the designated current pins.
4. Run:

```powershell
npm run plugin:release-check
```

5. Reinstall the Personal Marketplace Plugin and load the Claude Code plugin from the repository root. Restart the active client and confirm:
   - public Spot and USD-M Futures reads work;
   - `account_profiles_status` works without credentials and exposes only redacted profile metadata;
   - authenticated account reads are tested manually with a local Ed25519 profile and never with credentials stored in CI;
   - warehouse status/read tools work, while imports remain explicit state-changing actions with an explicit source;
   - no order placement, cancellation, leverage-change, transfer, or withdrawal capability exists;
   - market claims are timestamped and distinguish live data from the local warehouse;
   - MCP stdout remains clean JSON-RPC.
6. Commit the complete final release state. Only after all prior checks and both-client acceptance pass, create and verify the immutable annotated release tag on that commit:

```powershell
git tag -a vX.Y.Z -m "Binance Research Pro vX.Y.Z"
npm run check:final-release
git push origin main
git push origin vX.Y.Z
```

Do not create the final tag before package publication/verification, and never use a Git tag as a publish trigger.

## Rollback

Pin both MCP configurations to the last known-good immutable package, issue a new product patch release and Codex deployment revision, validate, and reinstall the active plugin. Do not overwrite, unpublish, or reuse a released GitHub Packages version.
