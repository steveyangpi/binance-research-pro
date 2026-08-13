import type { BinanceApiClient } from '../binance/api-client.js';
import type { AppConfig } from '../config.js';
import type { CacheStore } from '../cache/cache-store.js';
import { calculateIndicators } from './technical-indicators.js';

export class MarketAnalysisService {
  public constructor(
    private readonly client: BinanceApiClient,
    private readonly cache: CacheStore,
    private readonly config: AppConfig,
  ) {}

  public async candles(symbol: string, interval: string, limit: number) {
    return this.cache.getOrLoad(
      `klines:${symbol}:${interval}:${limit}`,
      this.config.BINANCE_CANDLE_CACHE_TTL_MS,
      () => this.client.getKlines(symbol, interval, limit),
    );
  }

  public async marketOverview(symbol?: string) {
    return this.cache.getOrLoad(`ticker:${symbol ?? 'all'}`, this.config.BINANCE_CACHE_TTL_MS, () =>
      this.client.get24hTicker(symbol),
    );
  }

  public async exchangeInfo(symbol: string) {
    return this.cache.getOrLoad(`exchange-info:${symbol}`, 60 * 60 * 1000, () =>
      this.client.getExchangeInfo(symbol),
    );
  }

  public async compareMarkets(symbols: string[]) {
    const results = await Promise.all(
      symbols.map(async (symbol) => (await this.marketOverview(symbol))[0]),
    );
    return results
      .filter((result) => result !== undefined)
      .sort((left, right) => right.quoteVolume - left.quoteVolume);
  }

  public async multiTimeframeAnalysis(symbol: string, intervals: string[], limit: number) {
    const analyses = await Promise.all(
      intervals.map((interval) => this.trendAnalysis(symbol, interval, limit)),
    );
    const knownTrends = analyses.filter((analysis) => analysis.trend !== 'insufficient_data');
    const uptrends = knownTrends.filter((analysis) => analysis.trend === 'uptrend').length;
    const alignment =
      knownTrends.length === 0
        ? 'insufficient_data'
        : uptrends === knownTrends.length
          ? 'bullish_aligned'
          : uptrends === 0
            ? 'bearish_aligned'
            : 'mixed';
    return {
      symbol,
      alignment,
      intervals: analyses,
      dataTime: Math.max(...analyses.map((analysis) => analysis.closeTime)),
      disclaimer:
        'Multi-timeframe public market-data analysis only; this is not investment advice.',
    };
  }

  public async orderBookSummary(symbol: string, limit: number) {
    const orderBook = await this.cache.getOrLoad(
      `depth:${symbol}:${limit}`,
      this.config.BINANCE_CACHE_TTL_MS,
      () => this.client.getOrderBook(symbol, limit),
    );
    const bestBid = orderBook.bids[0]?.[0];
    const bestAsk = orderBook.asks[0]?.[0];
    if (bestBid === undefined || bestAsk === undefined)
      throw new Error('Binance returned an empty order book');
    const bidNotional = orderBook.bids.reduce(
      (sum, [price, quantity]) => sum + price * quantity,
      0,
    );
    const askNotional = orderBook.asks.reduce(
      (sum, [price, quantity]) => sum + price * quantity,
      0,
    );
    return {
      ...orderBook,
      bestBid,
      bestAsk,
      spread: bestAsk - bestBid,
      spreadPercent: ((bestAsk - bestBid) / bestAsk) * 100,
      bidAskImbalance: bidNotional / (bidNotional + askNotional),
    };
  }

  public async indicatorAnalysis(symbol: string, interval: string, limit: number) {
    const candles = await this.candles(symbol, interval, limit);
    const latest = candles.at(-1);
    if (latest === undefined) throw new Error('No candle data returned from Binance');
    const indicators = calculateIndicators(candles);
    return {
      symbol,
      interval,
      candleCount: candles.length,
      latestClose: latest.close,
      closeTime: latest.closeTime,
      indicators,
    };
  }

  public async trendAnalysis(symbol: string, interval: string, limit: number) {
    const result = await this.indicatorAnalysis(symbol, interval, limit);
    const { indicators, latestClose } = result;
    const trend =
      indicators.ema20 === null
        ? 'insufficient_data'
        : latestClose > indicators.ema20
          ? 'uptrend'
          : 'downtrend';
    const momentum =
      indicators.rsi14 === null
        ? 'unknown'
        : indicators.rsi14 >= 70
          ? 'overbought'
          : indicators.rsi14 <= 30
            ? 'oversold'
            : 'neutral';
    return {
      ...result,
      trend,
      momentum,
      disclaimer: 'Market-data analysis only; this is not investment advice.',
    };
  }
}
