# MCP connection and troubleshooting

[简体中文](CONNECTING.zh-CN.md)

## Prerequisites

- Node.js 22.13 or newer.
- npm/npx and registry access for the first installation.
- Network access to the public Binance Spot and USDⓈ-M Futures APIs.
- Codex Desktop/CLI/IDE, Claude Code, or another local stdio MCP client.

## Recommended: launch a pinned npm version

Plugins and cross-machine deployments should use a fixed version instead of a source-tree path:

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@0.4.6 -- binance-research-pro-mcp
```

npx downloads and caches the private package on first launch. Configure the `@steveyangpi` GitHub Packages registry and authentication first. Upgrades are explicit version changes and must be revalidated.

Register it as a standalone Codex or Claude Code MCP only when the corresponding plugin is not installed:

```powershell
codex mcp add binance-research-pro -- npx -y --package=@steveyangpi/binance-research-pro-mcp@0.4.6 -- binance-research-pro-mcp
claude mcp add --scope local binance-research-pro -- npx -y --package=@steveyangpi/binance-research-pro-mcp@0.4.6 -- binance-research-pro-mcp
```

The repository plugin adapters already launch this server through `.mcp.json` for Codex and `claude.mcp.json` for Claude Code, so duplicate standalone registrations are unnecessary.

User-level `~/.codex/config.toml` example:

```toml
[mcp_servers.binance-research-pro]
command = "npx"
args = ["-y", "--package=@steveyangpi/binance-research-pro-mcp@0.4.6", "--", "binance-research-pro-mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 30
enabled = true
```

To move all runtime data to a chosen disk, add one variable:

```toml
[mcp_servers.binance-research-pro.env]
BINANCE_RESEARCH_DATA_DIR = "D:\\BinanceResearchPro"
```

Optional read-only account research uses `BINANCE_ACCOUNT_PROFILES_PATH` to reference a protected Ed25519 profile file outside the repository. Follow the [account-access guide](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/ACCOUNT-ACCESS.md); do not place credential values directly in the MCP configuration.

Codex Desktop, CLI, and IDE share the Codex MCP configuration. Start a new task or restart the client after changing it. Official reference: [OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## Other stdio MCP clients

```json
{
  "mcpServers": {
    "binance-research-pro": {
      "command": "npx",
      "args": [
        "-y",
        "--package=@steveyangpi/binance-research-pro-mcp@0.4.6",
        "--",
        "binance-research-pro-mcp"
      ],
      "env": {
        "BINANCE_RESEARCH_DATA_DIR": "D:\\BinanceResearchPro"
      }
    }
  }
}
```

Omit `env` to use the current operating system's per-user application-data directory.

## Source development and release verification

```powershell
cd <binance-research-pro repository>
npm install
npm run check
npm run test:package
```

- `test:mcp` launches a real MCP client against the current `dist` output.
- `test:package` packs a tarball, installs it in an isolated consumer project, then launches and handshakes with the installed package. It must pass before publishing.
- The publish workflow independently installs the exact GitHub Packages artifact, strips registry credentials, and handshakes through its absolute installed CLI path.
- `test:mcp:live` additionally calls public Binance endpoints.

## Verification prompts

1. `Call market_overview with symbol=BTCUSDT.`
2. `Call analyze_futures with symbol=BTCUSDT, interval=1h, limit=200.`
3. `Call warehouse_status and return dataDirectory, the Parquet root, and imported file count.`
4. `Call account_profiles_status and report only configured profile IDs and allowed surfaces.`

## Troubleshooting

| Symptom                     | Check                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| First startup times out     | Confirm registry access and raise `startup_timeout_sec` to 60 seconds.                                    |
| No tools are listed         | Run the pinned command directly, inspect installation errors, then restart the client.                    |
| Windows cannot find `npx`   | Ensure Node.js is on PATH; some clients may need `npx.cmd`.                                               |
| Binance timeout or 429      | Check network/region availability, reduce call frequency, or increase cache TTL.                          |
| Local import is rejected    | Call `warehouse_status` and import only from its `importRoots`.                                           |
| Offline startup is required | Warm the pinned package cache once, or use a private mirror/preinstalled package for fully offline hosts. |

## Security boundary

Public market tools require no credentials. Optional account tools accept only externally configured Ed25519 USER_DATA profiles and remain read-only. The server provides no order placement, cancellation, leverage-change, transfer, or withdrawal tools. Never put credential values or private account responses in MCP configuration, logs, screenshots, source control, or CI.
