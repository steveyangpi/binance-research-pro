# Releasing

MCP packages and Codex plugins are released in two stages because the plugin must always reference an installable package.

## Stage 1: publish the MCP package

1. Choose a new semantic version in `packages/mcp/package.json`. Never reuse a GitHub Packages version.
2. Update implementation, tests, Skills, changelog-facing documentation, and package READMEs.
3. Run:

```powershell
npm ci
npm run release:check
```

4. Review `npm pack --workspace packages/mcp --dry-run` output. No source secrets, runtime data, or monorepo-only files should be present.
5. Run the manual **Publish private MCP package** GitHub Actions workflow, or publish from an authorized environment:

```powershell
npm publish --workspace packages/mcp
```

6. In a clean environment, authenticate to GitHub Packages and run the exact published package.

At this point `.mcp.json` may still pin the previous package. That is expected and keeps the installed plugin working during publication.

## Stage 2: release the plugin

1. Update the exact `--package` version in `.mcp.json` to the verified package.
2. Update installation examples that show the current pin.
3. Bump `.codex-plugin/plugin.json` `version` as a cachebuster.
4. Run:

```powershell
npm run plugin:release-check
```

5. Reinstall the Personal marketplace plugin using the Codex development cachebuster/reinstall flow.
6. Fully restart Codex and test Spot, Futures, warehouse status, and unsupported trading requests.

## Rollback

Change `.mcp.json` back to the last known-good immutable package, bump the plugin cachebuster again, validate, and reinstall. Do not overwrite or unpublish a version as the normal rollback mechanism.
