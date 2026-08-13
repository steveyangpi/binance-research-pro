import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceFuturesApiClient } from '../src/binance/futures-api-client.js';
import type { AppConfig } from '../src/config.js';

const config: AppConfig = {
  BINANCE_REST_BASE_URL: 'https://api.binance.com',
  BINANCE_FUTURES_REST_BASE_URL: 'https://fapi.binance.com',
  BINANCE_REQUEST_TIMEOUT_MS: 10_000,
  BINANCE_CACHE_TTL_MS: 15_000,
  BINANCE_CANDLE_CACHE_TTL_MS: 60_000,
  BINANCE_FUNDING_CACHE_TTL_MS: 600_000,
  BINANCE_PERSISTENT_CACHE_ENABLED: true,
  BINANCE_CACHE_DB_PATH: './data/test.sqlite',
  BINANCE_CACHE_MAX_ENTRIES: 10_000,
};

afterEach(() => vi.unstubAllGlobals());

describe('BinanceFuturesApiClient', () => {
  it('normalizes premium-index fields and funding values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            symbol: 'KORUUSDT',
            markPrice: '16.92638434',
            indexPrice: '16.91201669',
            estimatedSettlePrice: '16.84733870',
            lastFundingRate: '0.00008243',
            nextFundingTime: 1786464000000,
            time: 1786441663143,
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await new BinanceFuturesApiClient(config).getPremiumIndex('KORUUSDT');

    expect(result.symbol).toBe('KORUUSDT');
    expect(result.markPrice).toBe(16.92638434);
    expect(result.lastFundingRate).toBe(0.00008243);
  });

  it('preserves the Binance error message for invalid futures symbols', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }), { status: 400 }),
        ),
    );

    await expect(new BinanceFuturesApiClient(config).getOpenInterest('NOPEUSDT')).rejects.toThrow(
      'Invalid symbol.',
    );
  });
});
