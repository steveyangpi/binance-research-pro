---
name: binance-account-research
description: Analyze explicitly configured Binance Spot balances and USD-M positions, open orders, and income using isolated read-only Ed25519 USER_DATA profiles. Use for account exposure and position-risk research. Do not use for trading, leverage changes, transfers, or withdrawals.
---

# Binance Account Research

Use only the bundled read-only account tools. If configuration is uncertain, call `account_profiles_status` before any private read.

## Choose the smallest useful read

- Spot asset exposure: `spot_account_overview`.
- USD-M position and liquidation context: `futures_positions`.
- Existing USD-M order exposure: `futures_open_orders`.
- Realized PnL, funding, or commission history: `futures_income_history`.

When multiple profiles cover the same surface, preserve the user's requested `profileId`; otherwise ask them to choose from the non-secret IDs returned by `account_profiles_status`. Never infer that one profile may stand in for another.

Combine private account facts with public market tools only when the question needs market context. Keep account facts, public market facts, calculations, and interpretation distinct.

## Safety boundary

- Treat balances, positions, orders, profile IDs, and income as sensitive user data. Return only what the task needs.
- All available account tools are reads. Never imply that a read changed an order, position, leverage setting, transfer, or withdrawal state.
- A declared profile surface is an application boundary, not proof of exchange-side permission. Report Binance permission or IP errors exactly and do not retry with another profile.
- Do not request, display, or store API keys, private keys, passphrases, signatures, or credential-file paths.
- Do not provide personalized trade instructions or claim guaranteed outcomes.

## Output

Identify the selected profile ID and data time, summarize material exposure, distinguish unrealized from realized values, and highlight liquidation, leverage, funding, concentration, or stale-data limitations relevant to the request.
