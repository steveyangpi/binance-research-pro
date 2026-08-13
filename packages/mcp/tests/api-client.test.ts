import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceApiClient } from '../src/binance/api-client.js';
import { loadConfig } from '../src/config.js';

afterEach(() => vi.unstubAllGlobals());

describe('BinanceApiClient', () => {
  it('preserves the Binance error message for invalid Spot symbols', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }), { status: 400 }),
        ),
    );

    await expect(new BinanceApiClient(loadConfig({})).get24hTicker('NOPEUSDT')).rejects.toThrow(
      'Binance returned HTTP 400: Invalid symbol.',
    );
  });

  it('bounds non-JSON error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(500), { status: 502 })),
    );

    await expect(new BinanceApiClient(loadConfig({})).get24hTicker('BTCUSDT')).rejects.toThrow(
      `Binance returned HTTP 502: ${'x'.repeat(200)}`,
    );
  });
});
