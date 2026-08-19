# Roadmap

## Current research product

- Codex plugin and private MCP source in one reviewed monorepo.
- Portable, exact private-package launch without checkout paths.
- Spot, USD-M Futures, local history, risk-review, and optional read-only account Skills.
- Isolated Ed25519 `USER_DATA` profiles for account reads, with no mutation endpoints.
- In-memory/SQLite caching and DuckDB/Parquet historical storage.
- Cross-platform data-root derivation, import-root confinement, and bounded HTTPS imports.
- Deterministic MCP, package-consumer, and cross-deliverable validation.

## Next

- Automate `data.binance.vision` catalog and checksum discovery.
- Add historical funding, open-interest, trader-ratio, taker-volume, and basis datasets.
- Surface request weight, source age, and retrieval timestamps consistently.
- Close the DNS-validation/connection gap for remote imports, or add a strict host allowlist.
- Add release provenance and artifact attestations.
- Add optional WebSocket market data with snapshot/delta sequencing tests.

## Explicitly separate future products

Trading belongs in another testnet-first service with preview, explicit confirmation, exchange-filter enforcement, idempotency, limits, and audit logs. It must not be enabled through an account-profile setting. Withdrawal capability remains out of scope.
