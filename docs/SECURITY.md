# Security

## Product boundary

- Public market and local-history research require no Binance credential.
- Optional account tools accept only external Ed25519 profiles declaring `USER_DATA` and `spot` and/or `usd-m-futures` read surfaces.
- The package contains no order placement, cancellation, leverage-change, transfer, or withdrawal request path.
- HMAC is not implemented. Trading or other mutation support requires a separate product and security review.

## Supply chain

- The plugin pins an exact private MCP version.
- GitHub Actions publishes only through the manual package workflow.
- GitHub Packages credentials belong in host npm configuration or CI secrets, never in this repository.
- Binance API keys, private keys, passphrases, profile files, signatures, and private responses must never enter the repository, CI, logs, fixtures, snapshots, cache, or warehouse.
- Package and plugin releases are separate stages; an unpublished source version must not be placed in `.mcp.json`.

## Network and storage

- Binance endpoint overrides require HTTPS.
- Responses are schema-validated. Only public market data may enter the response cache; private account responses are memory-only for the current request.
- Profile selection enforces declared surfaces. Authentication, permission, and IP failures never fall back to another profile.
- Remote warehouse imports require HTTPS, reject URL credentials and non-public destinations, revalidate redirects, and enforce time and byte limits.
- Local imports are confined to explicit roots after path and filesystem-link resolution.
- ZIP entries, extracted size, row counts, and SQL identifiers are validated before metadata is committed.

The current URL guard resolves DNS before `fetch`; DNS can theoretically change between validation and connection. For stronger isolation, restrict egress to trusted Binance/import hosts at the network layer. Imports should include SHA-256 when the source provides it.

## Reporting

Do not open a public issue containing a token, local path disclosure, or exploitable proof. Report security issues privately to the repository owner and include affected version, impact, reproduction, and suggested mitigation.
