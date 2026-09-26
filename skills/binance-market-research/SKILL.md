---
name: binance-market-research
description: Research Binance Spot markets using public market data. Use for prices, 24-hour comparisons, candlesticks, indicators, order books, exchange rules, liquidity, trend, momentum, volatility, and multi-timeframe analysis. Do not use for account balances, personalized investment advice, or order execution.
---

# Binance Spot Market Research

Use the bundled `binance-research-pro` MCP tools. They require no Binance API key.

## Choose the smallest useful workflow

- Single market snapshot: call `market_overview` with a symbol.
- Two or more symbols: call `compare_markets`; do not loop over `market_overview` unless necessary.
- OHLCV requested: call `get_candles`.
- Named indicators requested: call `analyze_indicators`.
- One timeframe trend: call `analyze_trend`.
- Cross-timeframe research: call `multi_timeframe_analysis` with 2–5 distinct intervals.
- Spread, depth, or imbalance: call `order_book_snapshot`.
- Realized aggressor flow, buy/sell imbalance, or VWAP over a past window: see the `binance-order-flow-research` skill.
- Precision, order types, or symbol filters: call `exchange_info`.

## Analysis rules

1. Preserve the user's symbol and interval choices. If omitted, use `1h`, `4h`, and `1d` for a multi-timeframe request.
2. Treat indicator values as deterministic calculations from returned K-lines, not predictions.
   `analyze_indicators` and `analyze_trend` fetch extra warmup candles beyond the requested
   `limit` so recursive averages are settled, and report `warmupCandles` and `candleCount`.
   Check `indicators.indicatorStatus` before quoting a value: a `degraded` ema20 is sitting on
   its SMA seed, and `insufficient_data` means the series was too short for that indicator.
3. A single order-book snapshot is transient and shows resting intent, not executed activity. Do not describe it as persistent buying or selling pressure, and do not present it as evidence of which side was aggressing. Realized aggressor flow comes from tape data, not from a book snapshot.
4. Separate market facts, calculated indicators, interpretation, and limitations.
5. Mention the latest data time. Report tool failures or insufficient data rather than filling gaps from memory.
6. Never claim guaranteed direction, profit, or a personalized buy/sell recommendation.

## Default output

- Scope: market, intervals, sample size, and data time.
- Facts: price, 24-hour change/volume, spread, or other requested observations.
- Indicators: only those relevant to the question.
- Interpretation: trend alignment, momentum, volatility, and conflicting evidence.
- Risks: stale snapshot, short sample, liquidity, or volatility limitations.
