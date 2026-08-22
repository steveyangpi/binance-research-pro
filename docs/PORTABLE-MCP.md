# Portable MCP runtime

Both plugin adapters launch the same immutable private package, not a repository file:

```json
{
  "command": "npx",
  "args": [
    "-y",
    "--package=@steveyangpi/binance-research-pro-mcp@0.4.4",
    "--",
    "binance-research-pro-mcp"
  ]
}
```

This makes both plugins independent of drive letters, checkout locations, and build output. Each host needs Node/npm and GitHub Packages authentication.

Configuration values are host-owned. The Codex adapter uses `.mcp.json` and its `env_vars` allowlist to forward optional values already present in its process environment. The Claude Code adapter uses `claude.mcp.json` and inherits its host process environment. Neither configuration embeds values. `BINANCE_RESEARCH_DATA_DIR` is the recommended single portability setting because all default cache and warehouse paths derive from it.

The exact package version prevents an unreviewed registry update from changing plugin behavior. Updating both adapters is stage two of the release process in `RELEASING.md`.
