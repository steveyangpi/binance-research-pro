export type ImportProfile =
  | 'binance-kline'
  | 'binance-trades'
  | 'binance-agg-trades'
  | 'binance-metrics'
  | 'binance-book-depth'
  | 'generic-csv'
  | 'parquet';

/** Dataset names stay lowercase so every warehouse partition value uses one convention. */
export const TAPE_PROFILE_FOR_DATASET = {
  trades: 'binance-trades',
  aggtrades: 'binance-agg-trades',
} as const;

export type TapeDataset = keyof typeof TAPE_PROFILE_FOR_DATASET;

export const TAPE_MARKETS = ['spot', 'um'] as const;
export type TapeMarket = (typeof TAPE_MARKETS)[number];

export function isTapeDataset(value: string): value is TapeDataset {
  return Object.hasOwn(TAPE_PROFILE_FOR_DATASET, value);
}

export function isTapeMarket(value: string): value is TapeMarket {
  return (TAPE_MARKETS as readonly string[]).includes(value);
}

export function tapeDatasetForProfile(profile: ImportProfile): TapeDataset | undefined {
  if (profile === 'binance-trades') return 'trades';
  if (profile === 'binance-agg-trades') return 'aggtrades';
  return undefined;
}

export type WarehouseImportRequest = {
  dataset: string;
  source: string;
  profile: ImportProfile;
  market?: string;
  symbol?: string;
  interval?: string;
  hasHeader?: boolean;
  zipEntry?: string;
  expectedSha256?: string;
};

export type WarehouseImportFileRequest = WarehouseImportRequest & {
  path: string;
};

export type WarehouseImportUrlRequest = WarehouseImportRequest & {
  url: string;
};

export type CandleSelection = {
  dataset: string;
  source?: string;
  market?: string;
  symbol: string;
  interval: string;
};

export type CandleQuery = CandleSelection & {
  startTime?: string;
  endTime?: string;
  limit: number;
};

/**
 * Tape selections require a market: spot and um trade IDs are independent
 * sequences, so an ID alone does not identify a trade (see the docs' 9.1).
 */
export type TapeSelection = {
  dataset: string;
  source?: string;
  market: string;
  symbol: string;
};

export type TapeQuery = TapeSelection & {
  startTime?: string;
  endTime?: string;
  limit: number;
  /** When set, the query aggregates into buckets instead of returning rows. */
  bucketSeconds?: number;
  /** Notional floor (`price * qty`) for large-order filtering; defaults to no floor. */
  minNotional?: number;
  /** Minimum resting orders consumed by one aggressor order. Aggregate trades only. */
  minSpan?: number;
  /** When `'price'`, aggregate per price level instead of per row. Requires bucketSeconds. */
  groupBy?: 'price';
};

/**
 * Snapshot datasets that are neither Klines nor tape: one time axis, optional extra key
 * columns, and numeric values. USD-M only, and their time column is a naive UTC string
 * rather than an epoch number.
 */
export const SERIES_PROFILE_FOR_DATASET = {
  metrics: 'binance-metrics',
  bookdepth: 'binance-book-depth',
} as const;

export type SeriesDataset = keyof typeof SERIES_PROFILE_FOR_DATASET;

export function isSeriesDataset(value: string): value is SeriesDataset {
  return Object.hasOwn(SERIES_PROFILE_FOR_DATASET, value);
}

export function seriesDatasetForProfile(profile: ImportProfile): SeriesDataset | undefined {
  if (profile === 'binance-metrics') return 'metrics';
  if (profile === 'binance-book-depth') return 'bookdepth';
  return undefined;
}

export type SeriesSelection = {
  dataset: string;
  source?: string;
  market: string;
  symbol: string;
};

export type SeriesQuery = SeriesSelection & {
  startTime?: string;
  endTime?: string;
  /** Book depth only: one signed percentage band (negative is the bid side). */
  percentage?: number;
  bucketSeconds?: number;
  limit: number;
};

export type TapeFileWindow = {
  startTime?: string;
  endTime?: string;
};

export type WarehouseFileFilter = {
  dataset?: string;
  source?: string;
  market?: string;
  symbol?: string;
  interval?: string;
  limit: number;
};

export type ImportedParquetFile = {
  path: string;
  rowCount: number;
  fileSizeBytes: number;
  year?: number;
  month?: number;
  minEventTime?: string;
  maxEventTime?: string;
};

export type ImportCompletion = {
  importId: string;
  dataset: string;
  source: string;
  profile: ImportProfile;
  checksumSha256: string;
  rowCount: number;
  duplicate: boolean;
  files: ImportedParquetFile[];
};
