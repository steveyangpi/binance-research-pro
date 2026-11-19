import { describe, expect, it, vi } from 'vitest';
import type { BinanceApiClient } from '../src/binance/api-client.js';
import type { BinanceFuturesApiClient } from '../src/binance/futures-api-client.js';
import { TtlCache } from '../src/cache/ttl-cache.js';
import { loadConfig } from '../src/config.js';
import { FuturesAnalysisService } from '../src/services/futures-analysis-service.js';
import { MarketAnalysisService } from '../src/services/market-analysis-service.js';

describe('MarketAnalysisService and FuturesAnalysisService zero-value guards', () => {
  it('returns null imbalance and spreadPercent instead of NaN when Spot order-book denominators are zero', async () => {
    const config = loadConfig({ BINANCE_PERSISTENT_CACHE_ENABLED: 'false' });
    const client = {
      getOrderBook: vi.fn().mockResolvedValue({
        lastUpdateId: 1,
        bids: [[0, 0]],
        asks: [[0, 0]],
      }),
    } as unknown as BinanceApiClient;
    const service = new MarketAnalysisService(client, new TtlCache(), config);

    await expect(service.orderBookSummary('BTCUSDT', 5)).resolves.toMatchObject({
      spread: 0,
      spreadPercent: null,
      bidAskImbalance: null,
    });
  });

  it('returns null basisPercent and spreadPercent when Futures denominators are zero', async () => {
    const config = loadConfig({ BINANCE_PERSISTENT_CACHE_ENABLED: 'false' });
    const client = {
      getPremiumIndex: vi.fn().mockResolvedValue({
        symbol: 'BTCUSDT',
        markPrice: 100,
        indexPrice: 0,
        estimatedSettlePrice: 0,
        lastFundingRate: 0.0001,
        nextFundingTime: 1_750_000_000_000,
        time: 1_750_000_000_000,
      }),
      getOrderBook: vi.fn().mockResolvedValue({
        lastUpdateId: 1,
        bids: [[0, 0]],
        asks: [[0, 0]],
      }),
    } as unknown as BinanceFuturesApiClient;
    const service = new FuturesAnalysisService(client, new TtlCache(), config);

    await expect(service.markPrice('BTCUSDT')).resolves.toMatchObject({
      basisPercent: null,
      fundingRatePercent: 0.01,
    });
    await expect(service.orderBookSummary('BTCUSDT', 5)).resolves.toMatchObject({
      spread: 0,
      spreadPercent: null,
      bidAskImbalance: null,
    });
  });
});
