import { BinanceApiError } from './api-client.js';
import type { AppConfig } from '../config.js';
import type {
  BinanceKline,
  FuturesFundingRate,
  FuturesOpenInterest,
  FuturesPremiumIndex,
  OrderBook,
  Ticker24h,
} from '../types/binance.js';

type QueryValue = string | number | undefined;

export class BinanceFuturesApiClient {
  public constructor(private readonly config: AppConfig) {}

  public async getKlines(symbol: string, interval: string, limit: number): Promise<BinanceKline[]> {
    const response = await this.get<unknown[][]>('/fapi/v1/klines', { symbol, interval, limit });
    return response.map((row) => this.toKline(row));
  }

  public async get24hTicker(symbol?: string): Promise<Ticker24h[]> {
    const payload = await this.get<unknown>('/fapi/v1/ticker/24hr', { symbol });
    const rows = Array.isArray(payload) ? payload : [payload];
    return rows.map((row) => this.toTicker(row));
  }

  public async getOrderBook(symbol: string, limit: number): Promise<OrderBook> {
    const payload = await this.get<Record<string, unknown>>('/fapi/v1/depth', { symbol, limit });
    return {
      lastUpdateId: this.number(payload.lastUpdateId, 'lastUpdateId'),
      bids: this.toLevels(payload.bids, 'bids'),
      asks: this.toLevels(payload.asks, 'asks'),
    };
  }

  public async getPremiumIndex(symbol: string): Promise<FuturesPremiumIndex> {
    const payload = await this.get<Record<string, unknown>>('/fapi/v1/premiumIndex', { symbol });
    return {
      symbol: this.string(payload.symbol, 'symbol'),
      markPrice: this.number(payload.markPrice, 'markPrice'),
      indexPrice: this.number(payload.indexPrice, 'indexPrice'),
      estimatedSettlePrice: this.number(payload.estimatedSettlePrice, 'estimatedSettlePrice'),
      lastFundingRate: this.number(payload.lastFundingRate, 'lastFundingRate'),
      nextFundingTime: this.number(payload.nextFundingTime, 'nextFundingTime'),
      time: this.number(payload.time, 'time'),
    };
  }

  public async getOpenInterest(symbol: string): Promise<FuturesOpenInterest> {
    const payload = await this.get<Record<string, unknown>>('/fapi/v1/openInterest', { symbol });
    return {
      symbol: this.string(payload.symbol, 'symbol'),
      openInterest: this.number(payload.openInterest, 'openInterest'),
      time: this.number(payload.time, 'time'),
    };
  }

  public async getFundingRateHistory(symbol: string, limit: number): Promise<FuturesFundingRate[]> {
    const rows = await this.get<Array<Record<string, unknown>>>('/fapi/v1/fundingRate', {
      symbol,
      limit,
    });
    return rows.map((row) => ({
      symbol: this.string(row.symbol, 'symbol'),
      fundingRate: this.number(row.fundingRate, 'fundingRate'),
      fundingTime: this.number(row.fundingTime, 'fundingTime'),
      markPrice: row.markPrice === undefined ? null : this.number(row.markPrice, 'markPrice'),
    }));
  }

  private async get<T>(path: string, query: Record<string, QueryValue>): Promise<T> {
    const url = new URL(path, this.config.BINANCE_FUTURES_REST_BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.BINANCE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const message = await this.errorMessage(response);
        throw new BinanceApiError(
          `Binance Futures returned HTTP ${response.status}: ${message}`,
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BinanceApiError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new BinanceApiError(`Unable to call Binance Futures public API: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = await response.text();
    try {
      const payload = JSON.parse(body) as { msg?: unknown };
      if (typeof payload.msg === 'string') return payload.msg;
    } catch {
      // Use the bounded response text below when Binance did not return JSON.
    }
    return body.slice(0, 200) || 'Unknown Binance Futures error';
  }

  private toKline(row: unknown[]): BinanceKline {
    if (row.length < 9) throw new BinanceApiError('Unexpected Futures kline payload');
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
    if (value === null || typeof value !== 'object') {
      throw new BinanceApiError('Unexpected Futures ticker payload');
    }
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
    if (!Array.isArray(value)) throw new BinanceApiError(`Unexpected Futures ${field} payload`);
    return value.map((level) => {
      if (!Array.isArray(level) || level.length < 2) {
        throw new BinanceApiError(`Invalid Futures ${field} level`);
      }
      return [this.number(level[0], field), this.number(level[1], field)];
    });
  }

  private number(value: unknown, field: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new BinanceApiError(`Invalid numeric ${field} in Binance Futures response`);
    }
    return parsed;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BinanceApiError(`Invalid ${field} in Binance Futures response`);
    }
    return value;
  }
}
