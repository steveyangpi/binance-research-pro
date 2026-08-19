---
name: binance-derivatives-research
description: Research Binance USD-M perpetual futures using public market data. Use for mark and index price, basis, funding, open interest, futures candles, futures order books, technical context, leverage risk, and derivatives market summaries. Do not use for positions, balances, leverage changes, or order execution.
---

# Binance USD-M Futures Research

Use the bundled public-data tools for market research. Account-specific reads belong to the separate `binance-account-research` skill and require an explicitly selected local Ed25519 profile.

## Workflow

- Broad or single-contract statistics: `futures_market_overview`.
- Mark/index basis and current funding: `futures_mark_price`.
- Funding history: `futures_funding_rate`.
- Current open interest: `futures_open_interest`.
- Futures OHLCV: `futures_candles`.
- Spread and depth imbalance: `futures_order_book_snapshot`.
- Combined contract analysis: `analyze_futures`.

For a serious contract review, prefer `analyze_futures`, then add funding history or an order-book snapshot only when the question requires them. Avoid redundant calls.

## Interpretation rules

1. Basis, funding, open interest, price trend, and liquidity are separate dimensions. Do not turn one dimension into a trading signal.
2. Current open interest is a level, not a change series. Do not infer rising or falling positioning without history.
3. Positive funding generally means longs pay shorts; negative funding generally means shorts pay longs. State the sign and time explicitly.
4. Mark price is the risk and liquidation reference; last traded price can differ.
5. Highlight leverage, liquidation, basis reversal, thin liquidity, and funding-cost risks.
6. Never claim knowledge of the user's account, position, liquidation price, or risk tolerance.

Return facts first, then interpretation, conflicting evidence, and a clear risk section.
