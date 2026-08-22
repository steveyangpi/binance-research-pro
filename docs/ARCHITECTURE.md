# Architecture

## Deliverables

The repository produces three coordinated deliverables:

```text
Codex plugin                         Claude Code plugin
  ├─ .codex-plugin/plugin.json         ├─ .claude-plugin/plugin.json
  ├─ skills/ (shared)                  ├─ skills/ (shared)
  └─ .mcp.json                         └─ claude.mcp.json
               \                         /
                └──npx/stdin/stdout──> private MCP npm package
                                             ├─ Spot and USD-M HTTP clients
                                             ├─ optional Ed25519 USER_DATA read client
                                             ├─ in-memory + SQLite response cache
                                             └─ DuckDB/Parquet history warehouse
```

A formal release shares one product version, `X.Y.Z`, across the root workspace, MCP package, both exact runtime pins, current installation documentation, Claude manifest, and final Git tag `vX.Y.Z`. The Codex manifest uses the same core plus a UTC deployment revision: `X.Y.Z+codex.YYYYMMDDHHmmss`. During MCP publication, source may lead both installed pins until the published package has been verified; `RELEASING.md` defines that two-stage gate.

## Runtime flow

1. Codex loads `.codex-plugin/plugin.json`; Claude Code loads `.claude-plugin/plugin.json`; both discover the five shared Skills.
2. Each client starts the same exact private package with `npx` through its client-specific MCP configuration.
3. Codex forwards only the optional variables listed in `env_vars`; Claude Code inherits host-owned environment values.
4. The MCP server exposes public market, optional private account reads, and local-warehouse tools over stdio JSON-RPC.
5. Skills select tools, interpret results, and enforce research and risk boundaries.

No checkout path is needed at runtime. Package authentication is handled by npm/GitHub Packages configuration on the host, outside the plugin.

## Data layers

- Live market layer: Binance public Spot and USD-M REST endpoints.
- Account-read layer: signed Spot and USD-M `USER_DATA` GET endpoints selected by an isolated profile ID. Responses are never cached or persisted.
- Ephemeral cache: deduplicates concurrent requests and applies short TTLs.
- Persistent cache: optional SQLite cache under the portable data directory.
- History warehouse: DuckDB metadata plus partitioned Parquet files. Imports accept allowlisted local roots or validated HTTPS sources.

## Trust boundaries

- Binance responses are untrusted network input and are schema-validated.
- The external account profile file and key material are sensitive local inputs. The parser accepts only Ed25519, `USER_DATA`, and declared read surfaces; status output redacts keys and paths.
- Environment endpoint overrides must use HTTPS.
- Remote warehouse downloads reject credentials, redirects to non-public addresses, and oversized bodies.
- Local imports must remain inside configured roots; resolved paths and filesystem links are checked.
- ZIP extraction validates entries and size limits before committing metadata.

DNS validation and the subsequent HTTP connection are separate operations in the current fetch implementation. This leaves a theoretical DNS-rebinding window; deployments should use trusted HTTPS import hosts and network egress controls for high-assurance environments.
