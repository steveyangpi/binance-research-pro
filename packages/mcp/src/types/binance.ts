export type BinanceKline = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteAssetVolume: number;
  tradeCount: number;
};

export type Ticker24h = {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
};

export type OrderBookLevel = [price: number, quantity: number];

export type OrderBook = {
  lastUpdateId: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export type FuturesPremiumIndex = {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  estimatedSettlePrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  time: number;
};

export type FuturesOpenInterest = {
  symbol: string;
  openInterest: number;
  time: number;
};

export type FuturesFundingRate = {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number | null;
};

export type SymbolFilter = Record<string, string | number | boolean> & {
  filterType: string;
};

export type ExchangeSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  orderTypes: string[];
  filters: SymbolFilter[];
};
