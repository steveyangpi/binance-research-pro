# Read-only account access

[简体中文](ACCOUNT-ACCESS.zh-CN.md)

Binance Research Pro can optionally read Binance Spot and USD-M Futures `USER_DATA` through Ed25519 API keys. Public market and warehouse tools continue to work without credentials. The MCP package contains no order placement, cancellation, leverage-change, transfer, or withdrawal endpoint.

## Credential boundary

Do not paste an API key, private key, or passphrase into ChatGPT, Codex, source files, issue trackers, or shell history. If a credential is disclosed, revoke it before continuing.

Create a dedicated Binance API key with read-only permissions. Keep `TRADE`, transfers, and withdrawals disabled. Binance currently recommends Ed25519 and marks HMAC keys deprecated.

The private key and account profile file must live outside the repository. Protect both with operating-system file permissions. An encrypted PKCS#8 PEM can use a separate one-line passphrase file; protect that file independently.

## Multiple isolated profiles

Set `BINANCE_ACCOUNT_PROFILES_PATH` to an external JSON file. One file can declare up to 20 isolated profiles:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "spot-read",
      "keyType": "ed25519",
      "apiKey": "SET_LOCALLY_DO_NOT_COMMIT",
      "privateKeyPath": "./spot-read-private.pem",
      "privateKeyPassphrasePath": "./spot-read-passphrase.txt",
      "surfaces": ["spot"],
      "permissions": ["USER_DATA"]
    },
    {
      "id": "futures-read",
      "keyType": "ed25519",
      "apiKey": "SET_LOCALLY_DO_NOT_COMMIT",
      "privateKeyPath": "./futures-read-private.pem",
      "surfaces": ["usd-m-futures"],
      "permissions": ["USER_DATA"]
    }
  ]
}
```

Relative key paths resolve from the profile file's directory. Only `ed25519`, `USER_DATA`, `spot`, and `usd-m-futures` are accepted. A profile cannot be used on a surface it does not declare. If several profiles cover the same surface, callers must pass `profileId` explicitly.

Configure the path on Windows without placing its contents in the repository:

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_ACCOUNT_PROFILES_PATH',
  'C:\Users\<you>\AppData\Local\BinanceResearchPro\credentials\account-profiles.json',
  'User'
)
```

Fully restart ChatGPT/Codex Desktop after changing a forwarded environment variable, then start a new chat and call `account_profiles_status`. The response intentionally contains only profile IDs, key types, surfaces, and declared `USER_DATA` permissions.

`BINANCE_ACCOUNT_RECV_WINDOW_MS` defaults to `5000` and cannot exceed `60000`. Keep it at or below `5000` unless diagnosing a known latency issue. Error `-1021` triggers one server-time synchronization and one retry; authentication and permission errors are never retried with another profile.

## Available reads

- `account_profiles_status`: local, redacted configuration status.
- `spot_account_overview`: Spot balances, with zero balances omitted by default.
- `futures_positions`: USD-M position risk, with flat positions omitted by default.
- `futures_open_orders`: current USD-M open orders.
- `futures_income_history`: realized PnL, funding, commissions, and other income records.

Private responses are validated and returned to the requesting MCP client. They are not written to the public SQLite response cache or the DuckDB/Parquet warehouse.

References: Binance official [API key types](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/api_key_types.md) and [SIGNED request security](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#request-security).
