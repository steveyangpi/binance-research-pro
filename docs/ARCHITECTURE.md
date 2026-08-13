# Architecture

## Deliverables

The repository produces two independently versioned artifacts:

```text
Codex plugin (repository root)
  ├─ manifest and Skills
  └─ .mcp.json ──npx/stdin/stdout──> private MCP npm package
                                      ├─ Spot and USD-M HTTP clients
                                      ├─ in-memory + SQLite response cache
                                      └─ DuckDB/Parquet history warehouse
```

The plugin version is a Codex cachebuster. The MCP package uses semantic versioning. Their versions are intentionally not required to match.

## Runtime flow

1. Codex loads `.codex-plugin/plugin.json` and discovers the four Skills.
2. `.mcp.json` starts an exact private package with `npx`.
3. Codex forwards only the optional variables listed in `env_vars`.
4. The MCP server exposes public market and local-warehouse tools over stdio JSON-RPC.
5. Skills select tools, interpret results, and enforce research and risk boundaries.

No checkout path is needed at runtime. Package authentication is handled by npm/GitHub Packages configuration on the host, outside the plugin.

## Data layers

- Live market layer: Binance public Spot and USD-M REST endpoints.
- Ephemeral cache: deduplicates concurrent requests and applies short TTLs.
- Persistent cache: optional SQLite cache under the portable data directory.
- History warehouse: DuckDB metadata plus partitioned Parquet files. Imports accept allowlisted local roots or validated HTTPS sources.

## Trust boundaries

- Binance responses are untrusted network input and are schema-validated.
- Environment endpoint overrides must use HTTPS.
- Remote warehouse downloads reject credentials, redirects to non-public addresses, and oversized bodies.
- Local imports must remain inside configured roots; resolved paths and filesystem links are checked.
- ZIP extraction validates entries and size limits before committing metadata.

DNS validation and the subsequent HTTP connection are separate operations in the current fetch implementation. This leaves a theoretical DNS-rebinding window; deployments should use trusted HTTPS import hosts and network egress controls for high-assurance environments.
