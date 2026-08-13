import type { BinanceFuturesApiClient } from '../binance/futures-api-client.js';
import type { CacheStore } from '../cache/cache-store.js';
import type { AppConfig } from '../config.js';
import { calculateIndicators } from './technical-indicators.js';

export class FuturesAnalysisService {
  public constructor(
    private readonly client: BinanceFuturesApiClient,
    private readonly cache: CacheStore,
    private readonly config: AppConfig,
  ) {}

  public async candles(symbol: string, interval: string, limit: number) {
    return this.cache.getOrLoad(
      `futures:klines:${symbol}:${interval}:${limit}`,
      this.config.BINANCE_CANDLE_CACHE_TTL_MS,
      () => this.client.getKlines(symbol, interval, limit),
    );
  }

  public async marketOverview(symbol?: string) {
    return this.cache.getOrLoad(
      `futures:ticker:${symbol ?? 'all'}`,
      this.config.BINANCE_CACHE_TTL_MS,
      () => this.client.get24hTicker(symbol),
    );
  }

  public async markPrice(symbol: string) {
    const result = await this.cache.getOrLoad(
      `futures:premium-index:${symbol}`,
      this.config.BINANCE_CACHE_TTL_MS,
      () => this.client.getPremiumIndex(symbol),
    );
    return {
      ...result,
      basisPercent: ((result.markPrice - result.indexPrice) / result.indexPrice) * 100,
      fundingRatePercent: result.lastFundingRate * 100,
    };
  }

  public async openInterest(symbol: string) {
    return this.cache.getOrLoad(
      `futures:open-interest:${symbol}`,
      this.config.BINANCE_CACHE_TTL_MS,
      () => this.client.getOpenInterest(symbol),
    );
  }

  public async fundingRateHistory(symbol: string, limit: number) {
    const results = await this.cache.getOrLoad(
      `futures:funding-rate:${symbol}:${limit}`,
      this.config.BINANCE_FUNDING_CACHE_TTL_MS,
      () => this.client.getFundingRateHistory(symbol, limit),
    );
    return results.map((result) => ({
      ...result,
      fundingRatePercent: result.fundingRate * 100,
    }));
  }

  public async orderBookSummary(symbol: string, limit: number) {
    const orderBook = await this.cache.getOrLoad(
      `futures:depth:${symbol}:${limit}`,
      this.config.BINANCE_CACHE_TTL_MS,
      () => this.client.getOrderBook(symbol, limit),
    );
    const bestBid = orderBook.bids[0]?.[0];
    const bestAsk = orderBook.asks[0]?.[0];
    if (bestBid === undefined || bestAsk === undefined) {
      throw new Error('Binance Futures returned an empty order book');
    }
    const bidNotional = orderBook.bids.reduce(
      (sum, [price, quantity]) => sum + price * quantity,
      0,
    );
    const askNotional = orderBook.asks.reduce(
      (sum, [price, quantity]) => sum + price * quantity,
      0,
    );
    const totalNotional = bidNotional + askNotional;
    return {
      ...orderBook,
      bestBid,
      bestAsk,
      spread: bestAsk - bestBid,
      spreadPercent: ((bestAsk - bestBid) / bestAsk) * 100,
      bidAskImbalance: totalNotional === 0 ? null : bidNotional / totalNotional,
    };
  }

  public async analyze(symbol: string, interval: string, limit: number) {
    const [candles, tickers, premium, openInterest] = await Promise.all([
      this.candles(symbol, interval, limit),
      this.marketOverview(symbol),
      this.markPrice(symbol),
      this.openInterest(symbol),
    ]);
    const latestCandle = candles.at(-1);
    const ticker = tickers[0];
    if (latestCandle === undefined || ticker === undefined) {
      throw new Error('Binance Futures returned incomplete analysis data');
    }
    const indicators = calculateIndicators(candles);
    const trend =
      indicators.ema20 === null
        ? 'insufficient_data'
        : latestCandle.close > indicators.ema20
          ? 'uptrend'
          : 'downtrend';

    return {
      symbol,
      interval,
      candleCount: candles.length,
      latestPrice: ticker.lastPrice,
      markPrice: premium.markPrice,
      indexPrice: premium.indexPrice,
      basisPercent: premium.basisPercent,
      fundingRatePercent: premium.fundingRatePercent,
      nextFundingTime: premium.nextFundingTime,
      openInterest: openInterest.openInterest,
      priceChangePercent24h: ticker.priceChangePercent,
      quoteVolume24h: ticker.quoteVolume,
      trend,
      indicators,
      dataTime: premium.time,
      disclaimer:
        'USD-M perpetual-futures market-data analysis only; leverage can amplify losses and this is not investment advice.',
    };
  }
}
