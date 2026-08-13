# Releasing

Binance Research Pro releases the private MCP package first, then the Codex Plugin that pins it. Push and pull-request CI only validate; publishing is manual through **Publish private MCP package** (`workflow_dispatch`). Never publish this package to public npm or a public marketplace.

## Version and Git contract

A formal release has one product version, `X.Y.Z`:

| Surface                                      | Required value                                |
| -------------------------------------------- | --------------------------------------------- |
| Root workspace and lockfile                  | `X.Y.Z`                                       |
| MCP package and workspace lockfile entry     | `X.Y.Z`                                       |
| `.mcp.json` exact package pin                | `@steveyangpi/binance-research-pro-mcp@X.Y.Z` |
| Current installation and connection examples | the same exact pin                            |
| Final annotated Git tag                      | `vX.Y.Z`                                      |
| Codex Plugin manifest                        | `X.Y.Z+codex.YYYYMMDDHHmmss`                  |

The 14-digit Codex suffix is a UTC deployment revision, not another product version. Use standard prereleases such as `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, and `X.Y.Z-rc.N` only during development. Until Stage 2, source may lead the installed Plugin pin; never point `.mcp.json` at unpublished source.

## Stage 1: publish and verify the private MCP package

1. Choose the next `X.Y.Z`, update the root workspace and `packages/mcp` package versions, and regenerate the root lockfile with npm. Update implementation, tests, canonical Skills, package READMEs, and English/Simplified Chinese documentation together.
2. Confirm `publishConfig` still targets `https://npm.pkg.github.com` with `access: restricted`. Do not add credentials, runtime data, public registry publication, account access, trading, transfers, or withdrawals.
3. Run:

```powershell
npm ci
npm run release:check
npm run test:package
npm pack --workspace packages/mcp --dry-run
```

4. Inspect the pack output: it must contain no secrets, local warehouse/runtime data, or monorepo-only files.
5. From an authorized GitHub Packages publishing environment, run the manual **Publish private MCP package** workflow. GitHub Packages versions are immutable; preflight must reject an existing version.
6. In a clean, authenticated consumer environment, install and start the exact published package using the same command shape as `.mcp.json`:

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@X.Y.Z -- binance-research-pro-mcp
```

Record a successful CLI/MCP stdio handshake before proceeding. Stage 2 is blocked until this check passes.

At this point `.mcp.json` may still pin the previous package. This is expected and keeps installed Plugins working during publication.

## Stage 2: release the Codex Plugin

1. Update `.mcp.json` to the verified exact package version.
2. Update every current installation/connection example in English and Simplified Chinese. `npm run plugin:release-check` validates the designated current pins.
3. Set `.codex-plugin/plugin.json` to `X.Y.Z+codex.YYYYMMDDHHmmss`, using a new UTC deployment revision.
4. Run:

```powershell
npm run plugin:release-check
```

5. Reinstall the Personal Marketplace Plugin, fully restart Codex, and confirm:
   - public Spot and USD-M Futures reads work;
   - warehouse status/read tools work, while imports remain explicit state-changing actions with an explicit source;
   - no API key, account, balance, position, order, transfer, or withdrawal capability exists;
   - market claims are timestamped and distinguish live data from the local warehouse;
   - MCP stdout remains clean JSON-RPC.
6. Commit the complete final release state. Only after all prior checks and Codex acceptance pass, create and verify the immutable annotated release tag on that commit:

```powershell
git tag -a vX.Y.Z -m "Binance Research Pro vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

Do not create the final tag before package publication/verification, and never use a Git tag as a publish trigger.

## Rollback

Pin `.mcp.json` to the last known-good immutable package, issue a new product patch release and Codex deployment revision, validate, and reinstall. Do not overwrite, unpublish, or reuse a released GitHub Packages version.
