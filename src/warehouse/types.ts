export type ImportProfile = 'binance-kline' | 'generic-csv' | 'parquet';

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

export type WarehouseFileFilter = {
  dataset?: string;
  source?: string;
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
