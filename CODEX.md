# CODEX.md

## Scope

This monorepo owns both the Binance Research Pro Codex plugin and its private MCP server. The root plugin launches an exact GitHub Packages version; it must never launch `packages/mcp`, a drive letter, or another local checkout at runtime.

## Working agreement

1. Read `README.md`, `docs/ARCHITECTURE.md`, and the closest package documentation before editing.
2. Keep authenticated scope read-only: Ed25519 `USER_DATA` profiles may read account data, but no trade, cancel, leverage-change, transfer, or withdrawal request may be implemented.
3. Never commit credentials or pass them through prompts, logs, errors, caches, warehouse files, fixtures, or snapshots. Account profile and key files stay outside the repository.
4. Never send an account API key to a configurable arbitrary origin or across a redirect. Preserve private decimal values and identifiers losslessly.
5. Treat MCP schemas and Skill instructions as one public interface. Change and test them together.
6. Prefer portable paths derived from `BINANCE_RESEARCH_DATA_DIR`; validate all import paths and HTTPS downloads.
7. Keep package logs off stdout because stdout carries JSON-RPC.
8. Maintain English and Chinese documentation in the same change.
9. Run `npm run check` and the package smoke test before handoff.

## Release invariant

GitHub Packages versions are immutable. During development, `packages/mcp/package.json` can contain the next version while `.mcp.json` continues to pin the last published version. Never update the plugin pin until the new private package can be installed successfully. See `docs/RELEASING.md`.

## Review priorities

- credential disclosure or mutation/execution capability accidentally entering scope;
- SSRF, unsafe redirects, archive extraction, and path-containment errors;
- unbounded responses, downloads, or DuckDB queries;
- stale package pins, hard-coded paths, or stdout logging;
- mismatched tool schemas, Skills, tests, and bilingual docs.
