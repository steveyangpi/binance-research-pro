---
name: binance-order-flow-research
description: Reconstruct order flow from imported Binance tape and series data for post-hoc review. Use to locate large aggressive orders, detect sweeps and order splitting, read cumulative volume delta and its divergences, reason about iceberg, absorption and exhaustion patterns, and cross-check taker flow against open interest. Do not use for live order-book monitoring or execution. Market data publishes no order IDs.
---

# Binance Order Flow Research

Review executed flow after the fact. Everything here measures trades that already
happened; none of it observes resting intent.

## What this data can and cannot answer

| Question                                    | Verdict                          | Basis                                                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| When did a large aggressor order hit?       | Answerable                       | One aggregate trade is one aggressor order at one price, so its size is directly readable                                                                                                                                |
| Was a resting queue swept across levels?    | Answerable                       | `span` counts how many resting orders one aggressor order consumed                                                                                                                                                       |
| Is aggressive flow confirming price?        | Answerable                       | `cvd` accumulates net taker delta across the window; divergence is readable against the price path                                                                                                                       |
| Absorption, or exhaustion?                  | Inference, but measurable        | Absorption is heavy aggression with no price progress; exhaustion is price progress on decaying volume. The two have different signatures and must be reported separately                                                |
| Was an order split into child orders?       | Inference only                   | Same side, close in time and price is the signature of splitting; common parentage cannot be proven                                                                                                                      |
| Was there an iceberg order?                 | Inference only                   | One level hit repeatedly on one side without price progress suggests hidden size; there is no book history to confirm replenishment                                                                                      |
| Which market moved first, spot or futures?  | Answerable as a sequence         | Both tapes exist for the same symbol, so bucket-level timing is comparable. This is description, not prediction                                                                                                          |
| Does a price band show wash-trading traces? | Inference only, never conclusive | Wash trading means one entity on both sides, and market data carries no account, order, or counterparty identity. Tape can flag two-way flow that is inconsistent with price discovery, and nothing more. See workflow G |
| Queue-level book delta or cancellations     | **Not answerable**               | No historical queue logs exist; depth archives are cumulative percentage bands                                                                                                                                           |

## Two hard boundaries

1. **There is no order ID.** Market data numbers executions, not orders or accounts. The
   ceiling for every conclusion is a _cluster of fills attributed to one aggressor order_ —
   never an order, and never a person.
2. **There is no historical order book.** Spot archives contain only aggregate trades,
   trades and Klines. USD-M depth archives are 30-second snapshots of cumulative depth
   inside percentage bands, not per-level queues, and the per-level best-bid/ask feed
   stopped in early 2024. Never assert queue position or cancellation behaviour.

## What is imported today — check before asserting

Coverage is the first thing to verify, because the analyses below are only possible where
the data exists. This list is a snapshot and grows; re-check it rather than trusting it.

```text
aggtrades    spot and um, BTCUSDT — 2026-08 plus parts of 2026-09
trades       NOT IMPORTED. No raw fills are in the warehouse at all
metrics      um only, BTCUSDT — same symbol and periods as the aggtrades above
bookdepth    um only, BTCUSDT, 2026-08
```

### Check coverage before analysing, and fill gaps before you analyse around them

A partial window produces numbers that look complete and are wrong. Two days out of a
seven-day request can come out net-buying while the full week is net-selling, and nothing
in the toolchain will flag the discrepancy. Do this first, every time:

1. **Work out how many days the window should contain.** A 7-day request needs 7 distinct
   days. Without that number there is nothing to compare the file count against.
2. **List the files and count the distinct days** for the dataset, market and symbol under
   study. Compare against step 1. Count days, not files: a symbol covered in two markets or
   in two datasets has more files than days.
3. **If days are missing, import them before analysing.** The tape and series datasets are
   available one day per archive from `data.binance.vision`, and re-importing is idempotent,
   so filling a gap is a few calls and safe. Run the analysis only after the count matches.
   Importing is a write; treat it as state-changing and confirm the source first.
4. **State the coverage at the top of the answer**, as days present out of days requested.
   If you cannot fill a gap, reduce the claim to the days that are present and say so — do
   not report a window-wide result from a subset.

Raw trade ID ranges bound where the fills were, but the individual fill sizes inside that
range are unavailable, so do not imply tick-level detail that cannot be read.

A range with a missing day still reports a continuous earliest and latest time. Read
coverage from the file listing, never from the range alone, and report gaps explicitly.
Missing coverage is not zero activity. Missing coverage is also not a reason to proceed:
fill it, or narrow the claim.

## Choose the dataset

```text
aggtrades   one aggressor order at one price per row; carries first/last trade IDs so a
            sweep size is readable; roughly a third of the row count of raw trades
trades      one fill per row; the only way to read an exact tick sequence
relation    aggregate trades partition raw trades exactly and without gaps, so these are
            two resolutions of one dataset, not two sources
metrics     five-minute open interest, top-trader and account long/short ratios, and an
            official taker buy/sell volume ratio
bookdepth   thirty-second cumulative depth per percentage band; negative is the bid side
```

### The official taker ratio is not comparable to a computed imbalance

The column sum_taker_long_short_vol_ratio is a **volume multiplier** — buy volume divided
by sell volume. It is bounded below by zero and unbounded above, so it centres on 1, not on 0.
A computed imbalance is a **signed share** centred on 0 and bounded by ±1. Comparing the raw
ratio directly against an imbalance is a units mismatch, and it produces opposite signs on
the same day.

Rescaling fixes the units but not the estimator:

```text
pm1 = (ratio - 1) / (ratio + 1)
```

Do **not** treat the rescaled value as a cross-check on the tape. `sum_taker_long_short_vol_ratio`
is the unweighted arithmetic mean of the five-minute ratios, while the tape imbalance is
volume-weighted. Per-sample dispersion is extreme — observed five-minute ratios span roughly
0.10 to 8.5 — so the right-skewed mean sits far above the volume-weighted value. Measured over
14 recent days, 8 of them carry the opposite sign to the tape imbalance.

Report the two as two independent readings with two different estimators, never as agreement
and never as a contradiction. Until the warehouse also exposes per-bucket taker buy and sell
volume for the metrics dataset, a true volume-weighted comparison cannot be built.

## Reading the columns

```text
bucket_start          start of the time bucket
trade_count           trades in the bucket
volume                base-asset volume
quote_volume          price * qty, derived — aggregate trades carry no quote quantity
vwap                  quote_volume / volume
taker_buy_volume      volume where the aggressor was the buyer
taker_sell_volume     volume where the aggressor was the seller
taker_imbalance       (buy - sell) / (buy + sell), in [-1, 1], null when the bucket is empty
taker_delta           buy - sell, in base units
cvd                   running sum of taker_delta across the returned rows
large_trade_count     trades at or above the notional floor
large_trade_notional  their combined notional
span                  resting orders consumed by one aggressor order (aggtrades only)
delta                 per price level: buy minus sell at that level
```

**CVD is anchored to the start of the requested window**, not to a session or a day. The
same bucket reports a different CVD under a different start time. Never compare CVD values
across queries with different windows, and always state the window alongside it.

## Workflows

### A. Macro flow and CVD divergence

1. Query aggregate trades with a bucket width, a notional floor, and a bounded window.
2. Read the price path against `cvd`:
   - price flat or lower while `cvd` rises steadily — sellers are being absorbed.
   - price at a new extreme while taker delta approaches zero and volume falls across
     two or three consecutive buckets — the move is running out of aggression.
3. Compare large-order notional against quote volume to find buckets where a handful of
   orders dominated. That ratio, not the raw totals, is what identifies a block-driven move.

### B. Sweeps versus single heavy fills

1. Take the bucket identified in A and query it at row level.
2. Filter with the notional floor, then separate by `span`: a large order that consumed many
   resting orders is a sweep; the same notional at a small span is one heavy fill against a
   single concentrated level. Both are large orders; they mean different things.

### C. Iceberg and absorption at the footprint level

1. Choose a narrow window — a handful of buckets, not a day.
2. Query with the bucket width and the price-level grouping, which returns one row per level
   with the buy/sell split, the net `delta`, the hit count and the time span.
3. Signature: a level with a high hit count, a strongly one-sided `delta`, a time span
   covering most of the bucket, and no price progress through it. That is passive size
   absorbing aggression. Report it as an inference and say what would confirm it.

### D. Absorption versus exhaustion — do not conflate them

Both are "aggression that did not work", but the signatures are opposite:

- **Absorption** — large aggressive volume at a level, price refuses to move, the level keeps
  getting hit across the bucket. The passive side is winning. It says a level held, nothing
  more; it is not a reversal signal.
- **Exhaustion** — price reaches a new extreme, but volume decays across consecutive buckets,
  taker delta decays toward zero or flips, and `cvd` flattens or turns against the price
  path. The aggressive side is running out. It says momentum faded, not that price must turn.

### E. Positioning regime — tape against open interest

Sample open interest at the same cadence as the tape window, then classify each interval:

| Net taker delta | Open-interest change | Regime                     |
| --------------- | -------------------- | -------------------------- |
| buy             | rising               | new long positions opened  |
| buy             | falling              | shorts closing             |
| sell            | rising               | new short positions opened |
| sell            | falling              | longs closing              |

Three cautions, all of which must appear in the output:

- Open interest is **contract-wide**, not per participant. It supports "new positions were
  opened or closed", never "institutions did this". The closest field to a participant-size
  signal is the top-trader long/short ratio in the same dataset; use that if the question is
  about large accounts.
- The metrics dataset is five-minute. A 60-second tape bucket cannot be aligned to it
  directly; aggregate the tape to five minutes first.
- The change needs two consecutive samples. A gap in the series produces a wrong delta, so
  check the spacing before classifying.

This is a descriptive classification of a past interval. It is not a forecast, and the
regime label alone does not say what happens next.

### F. Spot versus futures leadership

Run workflow A on the spot and USD-M tapes over the same window and bucket width, then
compare when each market's flow expanded. Report it as an observed sequence with the bucket
width that produced it: a finer bucket width can reverse the ordering, so a lead-lag claim
is only as good as its resolution.

Note that funding is not in the warehouse; it comes from the live funding tool, which is a
different source and cadence from the historical tape.

### G. Wash-trade screening inside a price band

Wash trading is one entity trading with itself. Market data carries no account, no order id,
and no counterparty, so nothing here proves it. What is measurable is whether a band shows
two-way flow that price discovery does not explain. Every result is a candidate, never a
finding.

1. Bound the band with the price bounds and choose a short window — minutes to a couple of
   hours. The statistic means less the longer the window gets.
2. For each level, take net as the signed sum of `delta` and gross as the sum of its absolute
   value **across the buckets in that window**, then read net over gross.
   - Near zero within a short window: buying and selling alternated at that level while price
     did not move through it. That is what a candidate looks like.
   - Near zero across a long window: ordinary. Price returned to the level many times and the
     signed deltas cancelled. **Always report how many buckets the level appeared in** — a
     level present across most buckets of a long window describes a level the market keeps
     revisiting, not an entity trading with itself.
3. Require all three conditions together: an abnormal hit count for that level, net over
   gross near zero, and no price progress through the level. Any one alone is unremarkable.
4. Check the absolute size. A perfectly balanced level that traded one or two coins across a
   day is market-maker inventory churn, not fabricated volume. Fabricated volume has to be
   large enough to be worth fabricating.
5. Where the data allows, look for corroboration rather than proof: cumulative depth that
   never drains while large volume prints. Both are reasons to look closer, not conclusions.

Report the band, the window, how many buckets the level appeared in, and the absolute sizes.
State plainly that the data cannot identify the parties.

## Parameter rules

- The notional floor defines what counts as large. Row-level queries return only qualifying
  trades; bucketed queries keep the whole population and fill the large-order columns
  instead, because filtering there would silently redefine the bucket totals.
- `minSpan` applies to aggregate trades only. Raw trades store one fill per row and have no
  span. Querying row level is the only mode that accepts it.
- The price bounds scope the whole query rather than defining which rows count, so they apply
  in every mode and every bucket then describes the band alone. Report the band with any
  result drawn from it — a band's volume is not the symbol's volume.
- The price-level grouping needs a bucket width **and** both time bounds. It is rejected
  without them, because an unbounded frame reads the whole history before the row cap bites.
  It also rejects the notional floor, which would distort the level distribution.
- A filter that has no meaning in the requested mode is rejected, never ignored. Treat any
  such error as a correction, not as a no-op to work around.
- The series tool takes no market argument; both series datasets exist for USD-M only.

## Defaults and tuning

- Default notional floor for "large": **100000** quote units. It sits near the 99.9th
  percentile for a major pair and yields roughly a thousand events per day, a reviewable
  volume. Ten thousand is too many to read; a million is too few.
- **Lower it for smaller symbols.** The default is calibrated on majors; for a mid- or
  small-capitalisation symbol it can exceed a whole day of activity.
- For `span`, the useful cut is symbol-dependent; check the distribution before fixing one.
  On a major pair, a span above roughly 20 is already unusual.
- Binance publishes no definition of a large order. Smart-money labels in the official
  product are defined by 30-day profit and loss, not order size, so the default here is a
  measured percentile, not an official threshold. State the floor you used.

## Output standard

Report under these headings, and keep observation separate from inference throughout:

```text
1. Coverage      window, bucket width, market and symbol, plus any missing days
2. Baseline      notional floor used, and why it is appropriate for this symbol; for any
                 hit-count screen, the per-level baseline split by price roundness
3. Macro flow    net delta, imbalance, CVD trend and whether it confirms or diverges
                 from price, and how concentrated the large orders were
4. Microstructure (labelled as inference) sweeps with time, price, size and span;
                 absorption and exhaustion levels, reported separately; wash candidates
                 with their band, bucket count and absolute size
5. Cross-checks  positioning regime if the metrics window is covered; spot versus
                 futures sequence if both tapes are covered
6. Limits        no order IDs, no historical queue data, and which of these conclusions
                 would need data the warehouse does not hold
```

## Interpretation rules

1. Label every splitting, iceberg, absorption and exhaustion claim as an inference, and say
   what evidence would confirm it.
2. Imbalance is not direction. A taker-side skew describes who crossed the spread.
3. Absorption is not a guaranteed reversal, and exhaustion is not a top or a bottom.
4. Do not merge flow with open interest, funding, or basis into a single directional claim.
   They measure different things at different cadences.
5. Never present a derived number as a source field. Aggregate trades carry no quote
   quantity; quote volume and VWAP are derived from price times quantity.
6. State the window with every number. CVD, in particular, is meaningless without its anchor.
7. Never state or imply a future price direction, a guaranteed outcome, or a personalised
   recommendation. Describe what happened and what it is consistent with.
8. A round price level is not evidence of anything. Round levels are hit far more often per
   level than others — on a major pair, roughly a hundred times more — so a screen for
   "unusually many hits" returns the round levels first and nothing else. Compare a level
   against others of the same kind before calling its hit count abnormal.
9. Two-way flow means nothing without its window. A level whose net aggression cancels is
   informative only when it cancelled inside a short window with price never leaving the
   band; across a long window it only means price kept coming back. Report the bucket count
   alongside the ratio, and never average the two away.
