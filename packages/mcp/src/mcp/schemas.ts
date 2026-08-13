import { z } from 'zod';

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5,30}$/, 'Use a Binance symbol such as BTCUSDT.');

export const intervalSchema = z.enum([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
]);

export const candleLimitSchema = z.number().int().min(20).max(500).default(200);

export const symbolsSchema = z
  .array(symbolSchema)
  .min(2)
  .max(20)
  .refine((symbols) => new Set(symbols).size === symbols.length, 'Symbols must be unique.');

export const intervalsSchema = z
  .array(intervalSchema)
  .min(2)
  .max(5)
  .default(['1h', '4h', '1d'])
  .refine((intervals) => new Set(intervals).size === intervals.length, 'Intervals must be unique.');
