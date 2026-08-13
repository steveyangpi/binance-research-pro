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
});
