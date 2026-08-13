# Security

## Product boundary

- No Binance key or secret is accepted.
- No account, balance, position, order, transfer, or withdrawal tool exists.
- Public-data research and local historical analysis are the only supported scopes.
- Authenticated or execution functionality must be a separate server and security review; it must not be added to this package.

## Supply chain

- The plugin pins an exact private MCP version.
- GitHub Actions publishes only through the manual package workflow.
- GitHub Packages credentials belong in host npm configuration or CI secrets, never in this repository.
- Package and plugin releases are separate stages; an unpublished source version must not be placed in `.mcp.json`.

## Network and storage

- Binance endpoint overrides require HTTPS.
- Responses are schema-validated and cache only public market data.
- Remote warehouse imports require HTTPS, reject URL credentials and non-public destinations, revalidate redirects, and enforce time and byte limits.
- Local imports are confined to explicit roots after path and filesystem-link resolution.
- ZIP entries, extracted size, row counts, and SQL identifiers are validated before metadata is committed.

The current URL guard resolves DNS before `fetch`; DNS can theoretically change between validation and connection. For stronger isolation, restrict egress to trusted Binance/import hosts at the network layer. Imports should include SHA-256 when the source provides it.

## Reporting

Do not open a public issue containing a token, local path disclosure, or exploitable proof. Report security issues privately to the repository owner and include affected version, impact, reproduction, and suggested mitigation.
