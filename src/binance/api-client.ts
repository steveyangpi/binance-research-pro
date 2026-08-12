import type { AppConfig } from '../config.js';
import type { BinanceKline, ExchangeSymbol, OrderBook, Ticker24h } from '../types/binance.js';

type QueryValue = string | number | undefined;

export class BinanceApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BinanceApiError';
  }
}

export class BinanceApiClient {
  public constructor(private readonly config: AppConfig) {}

  public async getKlines(symbol: string, interval: string, limit: number): Promise<BinanceKline[]> {
    const response = await this.get<unknown[][]>('/api/v3/klines', { symbol, interval, limit });
    return response.map((row) => this.toKline(row));
  }

  public async get24hTicker(symbol?: string): Promise<Ticker24h[]> {
    const payload = await this.get<unknown>('/api/v3/ticker/24hr', { symbol });
    const rows = Array.isArray(payload) ? payload : [payload];
    return rows.map((row) => this.toTicker(row));
  }

  public async getOrderBook(symbol: string, limit: number): Promise<OrderBook> {
    const payload = await this.get<Record<string, unknown>>('/api/v3/depth', { symbol, limit });
    return {
      lastUpdateId: this.number(payload.lastUpdateId, 'lastUpdateId'),
      bids: this.toLevels(payload.bids, 'bids'),
      asks: this.toLevels(payload.asks, 'asks'),
    };
  }

  public async getExchangeInfo(symbol: string): Promise<ExchangeSymbol> {
    const payload = await this.get<Record<string, unknown>>('/api/v3/exchangeInfo', { symbol });
    const symbols = payload.symbols;
    if (!Array.isArray(symbols) || symbols.length !== 1) {
      throw new BinanceApiError(`Binance did not return exchange information for ${symbol}`);
    }
    const row = symbols[0];
    if (row === null || typeof row !== 'object') {
      throw new BinanceApiError('Unexpected exchangeInfo payload from Binance');
    }
    const value = row as Record<string, unknown>;
    return {
      symbol: this.string(value.symbol, 'symbol'),
      status: this.string(value.status, 'status'),
      baseAsset: this.string(value.baseAsset, 'baseAsset'),
      quoteAsset: this.string(value.quoteAsset, 'quoteAsset'),
      baseAssetPrecision: this.number(value.baseAssetPrecision, 'baseAssetPrecision'),
      quoteAssetPrecision: this.number(value.quoteAssetPrecision, 'quoteAssetPrecision'),
      orderTypes: this.stringArray(value.orderTypes, 'orderTypes'),
      filters: this.filters(value.filters),
    };
  }

  private async get<T>(path: string, query: Record<string, QueryValue>): Promise<T> {
    const url = new URL(path, this.config.BINANCE_REST_BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.BINANCE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new BinanceApiError(`Binance returned HTTP ${response.status}`, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BinanceApiError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new BinanceApiError(`Unable to call Binance public API: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private toKline(row: unknown[]): BinanceKline {
    if (row.length < 9) throw new BinanceApiError('Unexpected kline payload from Binance');
    return {
      openTime: this.number(row[0], 'openTime'),
      open: this.number(row[1], 'open'),
      high: this.number(row[2], 'high'),
      low: this.number(row[3], 'low'),
      close: this.number(row[4], 'close'),
      volume: this.number(row[5], 'volume'),
      closeTime: this.number(row[6], 'closeTime'),
      quoteAssetVolume: this.number(row[7], 'quoteAssetVolume'),
      tradeCount: this.number(row[8], 'tradeCount'),
    };
  }

  private toTicker(value: unknown): Ticker24h {
    if (value === null || typeof value !== 'object')
      throw new BinanceApiError('Unexpected ticker payload');
    const row = value as Record<string, unknown>;
    return {
      symbol: this.string(row.symbol, 'symbol'),
      lastPrice: this.number(row.lastPrice, 'lastPrice'),
      priceChangePercent: this.number(row.priceChangePercent, 'priceChangePercent'),
      quoteVolume: this.number(row.quoteVolume, 'quoteVolume'),
      highPrice: this.number(row.highPrice, 'highPrice'),
      lowPrice: this.number(row.lowPrice, 'lowPrice'),
    };
  }

  private toLevels(value: unknown, field: string): OrderBook['bids'] {
    if (!Array.isArray(value)) throw new BinanceApiError(`Unexpected ${field} payload`);
    return value.map((level) => {
      if (!Array.isArray(level) || level.length < 2)
        throw new BinanceApiError(`Invalid ${field} level`);
      return [this.number(level[0], field), this.number(level[1], field)];
    });
  }

  private number(value: unknown, field: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed))
      throw new BinanceApiError(`Invalid numeric ${field} in Binance response`);
    return parsed;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0)
      throw new BinanceApiError(`Invalid ${field} in Binance response`);
    return value;
  }

  private stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new BinanceApiError(`Invalid ${field} in Binance response`);
    }
    return value;
  }

  private filters(value: unknown): ExchangeSymbol['filters'] {
    if (!Array.isArray(value)) throw new BinanceApiError('Invalid filters in Binance response');
    return value.map((entry) => {
      if (entry === null || typeof entry !== 'object') {
        throw new BinanceApiError('Invalid exchange filter in Binance response');
      }
      const filter = entry as Record<string, unknown>;
      const filterType = this.string(filter.filterType, 'filterType');
      const normalized: Record<string, string | number | boolean> = { filterType };
      for (const [key, item] of Object.entries(filter)) {
        if (key !== 'filterType' && ['string', 'number', 'boolean'].includes(typeof item)) {
          normalized[key] = item as string | number | boolean;
        }
      }
      return normalized as ExchangeSymbol['filters'][number];
    });
  }
}
