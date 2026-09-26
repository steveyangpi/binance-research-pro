import { describe, expect, it } from 'vitest';
import type { BinanceKline } from '../src/types/binance.js';
import { calculateIndicators, simpleMovingAverage } from '../src/services/technical-indicators.js';

const candles: BinanceKline[] = Array.from({ length: 40 }, (_, index) => ({
  openTime: index,
  closeTime: index + 1,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 10,
  quoteAssetVolume: 1000,
  tradeCount: 5,
}));

describe('technical indicators', () => {
  it('calculates rolling SMA values', () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
  });

  it('calculates the supported analysis set', () => {
    const result = calculateIndicators(candles);
    expect(result.sma20).toBe(130.5);
    expect(result.ema20).not.toBeNull();
    expect(result.rsi14).toBe(100);
    expect(result.macd).not.toBeNull();
    expect(result.bollinger20?.upper).toBeGreaterThan(result.bollinger20?.middle ?? 0);
    expect(result.atr14).toBeGreaterThan(0);
  });

  it('returns neutral RSI for a completely flat market', () => {
    const flatCandles = candles.map((candle) => ({
      ...candle,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }));
    expect(calculateIndicators(flatCandles).rsi14).toBe(50);
  });

  it('separates ema20 from sma20 once a recursive step exists', () => {
    // A straight ramp is the one series where ema20 and sma20 coincide exactly, because the
    // trailing 20-candle mean of a line sits at the same offset the EMA converges to. A
    // curved series is required to tell the two apart.
    const curved = candles.map((candle, index) => ({
      ...candle,
      close: 100 + 10 * Math.sin(index / 3) + index * 0.5,
    }));
    const result = calculateIndicators(curved);
    expect(result.sma20).not.toBeNull();
    expect(result.ema20).not.toBeNull();
    expect(result.ema20).not.toBe(result.sma20);
    expect(result.indicatorStatus.ema20.status).toBe('ok');
  });

  it('flags ema20 as degraded when only the SMA seed is available', () => {
    const seedOnly = candles.slice(-20);
    const result = calculateIndicators(seedOnly);
    expect(result.ema20).toBe(result.sma20);
    expect(result.indicatorStatus.ema20.status).toBe('degraded');
    expect(result.indicatorStatus.ema20.requiredCandles).toBe(21);
    expect(result.indicatorStatus.macd.status).toBe('insufficient_data');
  });

  it('reports insufficient data below the smallest usable series', () => {
    const result = calculateIndicators(candles.slice(-14));
    expect(result.sma20).toBeNull();
    expect(result.rsi14).toBeNull();
    expect(result.indicatorStatus.sma20.status).toBe('insufficient_data');
    expect(result.indicatorStatus.sma20.requiredCandles).toBe(20);
    expect(result.indicatorStatus.rsi14.status).toBe('insufficient_data');
  });

  it('produces a MACD signal only once 34 candles are available', () => {
    expect(calculateIndicators(candles.slice(-33)).macd).toBeNull();
    expect(calculateIndicators(candles.slice(-34)).macd).not.toBeNull();
  });
});
