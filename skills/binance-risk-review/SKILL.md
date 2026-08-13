---
name: binance-risk-review
description: Review the quality, freshness, limitations, and market risk of Binance Spot or USD-M Futures research. Use when the user asks whether an analysis is reliable, requests a risk review, or may rely on market data for a consequential decision. This skill does not provide personalized financial advice or execute trades.
---

# Binance Research Risk Review

Review evidence produced by bundled Binance tools. If evidence is missing, call the smallest read-only tools needed to verify it.

## Checklist

- Data identity: Spot versus USD-M Futures, symbol, interval, and sample size.
- Freshness: latest candle close, market-data time, and point-in-time order books.
- Completeness: missing intervals, missing history, null indicators, or partial failures.
- Liquidity: quote volume, spread, and depth limitations.
- Derivatives: basis, funding sign and time, current open interest, and leverage/liquidation risk.
- Method: distinguish raw Binance fields, deterministic calculations, and model interpretation.
- Conflicts: surface mixed timeframes or indicators instead of averaging them into false certainty.

## Required conclusion

Give one of: `adequate for descriptive research`, `usable with material limitations`, or `insufficient evidence`. Explain the deciding limitations. Do not give a confidence percentage unless a defined statistical method produced it.
