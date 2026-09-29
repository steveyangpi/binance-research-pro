import type { BinanceKline } from '../types/binance.js';

export type IndicatorName = 'sma20' | 'ema20' | 'rsi14' | 'macd' | 'bollinger20' | 'atr14';

export type IndicatorStatus = {
  status: 'ok' | 'degraded' | 'insufficient_data';
  requiredCandles: number;
  reason: string;
};

export type IndicatorResult = {
  sma20: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  bollinger20: { lower: number; middle: number; upper: number } | null;
  atr14: number | null;
  indicatorStatus: Record<IndicatorName, IndicatorStatus>;
};

/**
 * Extra candles fetched beyond the requested window so recursive indicators reach a settled
 * value. MACD is the binding constraint: its line needs 25 candles and its signal line needs
 * 9 more, so 34 is the smallest input that yields a real histogram.
 */
export const INDICATOR_WARMUP_CANDLES = 60;

export const INDICATOR_REQUIRED_CANDLES: Record<IndicatorName, number> = {
  sma20: 20,
  ema20: 21,
  rsi14: 15,
  macd: 34,
  bollinger20: 20,
  atr14: 15,
};

const round = (value: number): number => Number(value.toFixed(8));

export function calculateIndicators(candles: BinanceKline[]): IndicatorResult {
  const closes = candles.map((candle) => candle.close);
  const sma20 = simpleMovingAverage(closes, 20);
  const ema20 = exponentialMovingAverage(closes, 20);
  const result: Omit<IndicatorResult, 'indicatorStatus'> = {
    sma20: sma20.at(-1) ?? null,
    ema20: ema20.at(-1) ?? null,
    rsi14: calculateRsi(closes, 14),
    macd: calculateMacd(closes),
    bollinger20: calculateBollinger(closes, 20),
    atr14: calculateAtr(candles, 14),
  };
  return { ...result, indicatorStatus: describeIndicatorStatus(closes.length, result) };
}

function describeIndicatorStatus(
  candleCount: number,
  result: Omit<IndicatorResult, 'indicatorStatus'>,
): Record<IndicatorName, IndicatorStatus> {
  const describe = (name: IndicatorName, available: boolean): IndicatorStatus => {
    const requiredCandles = INDICATOR_REQUIRED_CANDLES[name];
    if (!available) {
      return {
        status: 'insufficient_data',
        requiredCandles,
        reason: `Needs at least ${requiredCandles} candles, received ${candleCount}.`,
      };
    }
    if (name === 'ema20' && candleCount === INDICATOR_REQUIRED_CANDLES.ema20 - 1) {
      return {
        status: 'degraded',
        requiredCandles,
        reason:
          'Only the SMA seed exists, so ema20 is identical to sma20. Use at least 21 candles, ' +
          'or rely on the warmup candles fetched for you.',
      };
    }
    return { status: 'ok', requiredCandles, reason: 'Computed over a fully warmed series.' };
  };
  return {
    sma20: describe('sma20', result.sma20 !== null),
    ema20: describe('ema20', result.ema20 !== null),
    rsi14: describe('rsi14', result.rsi14 !== null),
    macd: describe('macd', result.macd !== null),
    bollinger20: describe('bollinger20', result.bollinger20 !== null),
    atr14: describe('atr14', result.atr14 !== null),
  };
}

export function simpleMovingAverage(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const result: number[] = [];
  let sum = values.slice(0, period).reduce((total, value) => total + value, 0);
  result.push(sum / period);
  for (let index = period; index < values.length; index += 1) {
    sum += values[index]! - values[index - period]!;
    result.push(sum / period);
  }
  return result;
}

export function exponentialMovingAverage(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result = [values.slice(0, period).reduce((total, value) => total + value, 0) / period];
  for (let index = period; index < values.length; index += 1) {
    result.push(values[index]! * multiplier + result[index - period]! * (1 - multiplier));
  }
  return result;
}

function calculateRsi(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index]! - closes[index - 1]!;
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index]! - closes[index - 1]!;
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  return round(100 - 100 / (1 + averageGain / averageLoss));
}

function calculateMacd(closes: number[]): IndicatorResult['macd'] {
  const fast = exponentialMovingAverage(closes, 12);
  const slow = exponentialMovingAverage(closes, 26);
  if (slow.length === 0) return null;
  const alignedFast = fast.slice(fast.length - slow.length);
  const line = alignedFast.map((value, index) => value - slow[index]!);
  const signal = exponentialMovingAverage(line, 9);
  if (signal.length === 0) return null;
  const latestLine = line.at(-1)!;
  const latestSignal = signal.at(-1)!;
  return {
    line: round(latestLine),
    signal: round(latestSignal),
    histogram: round(latestLine - latestSignal),
  };
}

function calculateBollinger(closes: number[], period: number): IndicatorResult['bollinger20'] {
  const window = closes.slice(-period);
  if (window.length < period) return null;
  const middle = window.reduce((total, value) => total + value, 0) / period;
  const deviation = Math.sqrt(
    window.reduce((total, value) => total + (value - middle) ** 2, 0) / period,
  );
  return {
    lower: round(middle - 2 * deviation),
    middle: round(middle),
    upper: round(middle + 2 * deviation),
  };
}

function calculateAtr(candles: BinanceKline[], period: number): number | null {
  if (candles.length <= period) return null;
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index]!.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  if (ranges.length < period) return null;
  let atr = ranges.slice(0, period).reduce((total, value) => total + value, 0) / period;
  for (const range of ranges.slice(period)) atr = (atr * (period - 1) + range) / period;
  return round(atr);
}
