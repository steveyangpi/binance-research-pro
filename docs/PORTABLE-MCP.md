# Portable MCP runtime

The installed plugin launches an immutable private package, not a repository file:

```json
{
  "command": "npx",
  "args": [
    "-y",
    "--package=@steveyangpi/binance-research-pro-mcp@0.3.1",
    "--",
    "binance-research-pro-mcp"
  ]
}
```

This makes the plugin independent of drive letters, checkout locations, and build output. Each host needs Node/npm and GitHub Packages authentication.

Configuration values are host-owned. `.mcp.json` lists optional `env_vars` so Codex may forward values already present in its process environment; it does not embed them. `BINANCE_RESEARCH_DATA_DIR` is the recommended single portability setting because all default cache and warehouse paths derive from it.

The exact package version prevents an unreviewed registry update from changing plugin behavior. Updating it is stage two of the release process in `RELEASING.md`.
