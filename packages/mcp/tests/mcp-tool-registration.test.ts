import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import type { AccountReadService } from '../src/services/account-read-service.js';
import type { FuturesAnalysisService } from '../src/services/futures-analysis-service.js';
import type { MarketAnalysisService } from '../src/services/market-analysis-service.js';
import { registerAccountTools } from '../src/mcp/register-account-tools.js';
import { registerFuturesTools } from '../src/mcp/register-futures-tools.js';
import { registerMarketTools } from '../src/mcp/register-tools.js';
import { registerWarehouseTools } from '../src/mcp/register-warehouse-tools.js';
import type { WarehouseService } from '../src/warehouse/warehouse-service.js';

type ToolHandler = (arguments_: Record<string, unknown>) => Promise<{ isError?: boolean }>;

class ToolCapture {
  public readonly handlers = new Map<string, ToolHandler>();

  public registerTool(name: string, _definition: unknown, handler: unknown): void {
    this.handlers.set(name, handler as ToolHandler);
  }
}

async function invokeAll(
  capture: ToolCapture,
  inputs: Record<string, Record<string, unknown>>,
): Promise<void> {
  for (const [name, input] of Object.entries(inputs)) {
    const handler = capture.handlers.get(name);
    expect(handler, `${name} must be registered`).toBeDefined();
    const result = await handler!(input);
    expect(result.isError).not.toBe(true);
  }
}

function trackedService(calls: Array<[string, unknown[]]>) {
  return new Proxy(
    {},
    {
      get(target, property) {
        if (Reflect.has(target, property)) return Reflect.get(target, property);
        return async (...arguments_: unknown[]) => {
          const name = String(property);
          calls.push([name, arguments_]);
          if (name === 'marketOverview') return [{ symbol: 'BTCUSDT', quoteVolume: 1 }];
          return { name, arguments_ };
        };
      },
    },
  );
}

describe('MCP tool registration contracts', () => {
  it('invokes every Spot handler with its documented argument shape', async () => {
    const capture = new ToolCapture();
    const calls: Array<[string, unknown[]]> = [];
    registerMarketTools(
      capture as unknown as McpServer,
      trackedService(calls) as unknown as MarketAnalysisService,
    );

    await invokeAll(capture, {
      market_overview: {},
      get_candles: { symbol: 'BTCUSDT', interval: '1h', limit: 200 },
      analyze_indicators: { symbol: 'BTCUSDT', interval: '1h', limit: 200 },
      analyze_trend: { symbol: 'BTCUSDT', interval: '1h', limit: 200 },
      order_book_snapshot: { symbol: 'BTCUSDT', limit: 100 },
      exchange_info: { symbol: 'BTCUSDT' },
      compare_markets: { symbols: ['BTCUSDT', 'ETHUSDT'] },
      multi_timeframe_analysis: {
        symbol: 'BTCUSDT',
        intervals: ['1h', '4h'],
        limit: 200,
      },
    });

    expect(calls.map(([name]) => name)).toEqual([
      'marketOverview',
      'candles',
      'indicatorAnalysis',
      'trendAnalysis',
      'orderBookSummary',
      'exchangeInfo',
      'compareMarkets',
      'multiTimeframeAnalysis',
    ]);
  });

  it('invokes every Futures handler with its documented argument shape', async () => {
    const capture = new ToolCapture();
    const calls: Array<[string, unknown[]]> = [];
    registerFuturesTools(
      capture as unknown as McpServer,
      trackedService(calls) as unknown as FuturesAnalysisService,
    );

    await invokeAll(capture, {
      futures_market_overview: {},
      futures_mark_price: { symbol: 'BTCUSDT' },
      futures_candles: { symbol: 'BTCUSDT', interval: '1h', limit: 200 },
      futures_order_book_snapshot: { symbol: 'BTCUSDT', limit: 100 },
      futures_open_interest: { symbol: 'BTCUSDT' },
      futures_funding_rate: { symbol: 'BTCUSDT', limit: 20 },
      analyze_futures: { symbol: 'BTCUSDT', interval: '1h', limit: 200 },
    });

    expect(calls.map(([name]) => name)).toEqual([
      'marketOverview',
      'markPrice',
      'candles',
      'orderBookSummary',
      'openInterest',
      'fundingRateHistory',
      'analyze',
    ]);
  });

  it('invokes every account handler without exposing a write path', async () => {
    const capture = new ToolCapture();
    const calls: Array<[string, unknown[]]> = [];
    registerAccountTools(
      capture as unknown as McpServer,
      trackedService(calls) as unknown as AccountReadService,
    );

    await invokeAll(capture, {
      account_profiles_status: {},
      spot_account_overview: { profileId: 'research', includeZeroBalances: false },
      futures_positions: { profileId: 'research', symbol: 'BTCUSDT', includeFlat: false },
      futures_open_orders: { profileId: 'research', symbol: 'BTCUSDT' },
      futures_income_history: {
        profileId: 'research',
        symbol: 'BTCUSDT',
        incomeType: 'REALIZED_PNL',
        startTime: 1,
        endTime: 2,
        limit: 100,
      },
    });

    expect(calls.map(([name]) => name)).toEqual([
      'profilesStatus',
      'spotAccountOverview',
      'futuresPositions',
      'futuresOpenOrders',
      'futuresIncomeHistory',
    ]);
    expect(calls[4]?.[1]).toEqual([
      {
        profileId: 'research',
        symbol: 'BTCUSDT',
        incomeType: 'REALIZED_PNL',
        startTime: 1,
        endTime: 2,
        limit: 100,
      },
    ]);
  });

  it('invokes every warehouse handler with explicit import metadata', async () => {
    const capture = new ToolCapture();
    const calls: Array<[string, unknown[]]> = [];
    const service = trackedService(calls) as Record<string, (...arguments_: unknown[]) => unknown>;
    service.status = (...arguments_) => {
      calls.push(['status', arguments_]);
      return { enabled: true };
    };
    service.listDatasets = (...arguments_) => {
      calls.push(['listDatasets', arguments_]);
      return [];
    };
    service.listFiles = (...arguments_) => {
      calls.push(['listFiles', arguments_]);
      return [];
    };
    registerWarehouseTools(capture as unknown as McpServer, service as unknown as WarehouseService);

    const metadata = {
      dataset: 'candles',
      source: 'fixture',
      profile: 'binance-kline',
      symbol: 'BTCUSDT',
      interval: '1h',
    };
    await invokeAll(capture, {
      warehouse_import_file: { path: 'fixture.csv', ...metadata },
      warehouse_import_url: { url: 'https://example.com/fixture.csv', ...metadata },
      warehouse_status: {},
      warehouse_list_datasets: {},
      warehouse_list_files: { limit: 100 },
      warehouse_query_candles: {
        dataset: 'candles',
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: 500,
      },
      warehouse_query_trades: {
        dataset: 'trades',
        market: 'spot',
        symbol: 'BTCUSDT',
        limit: 500,
      },
      warehouse_query_series: {
        dataset: 'metrics',
        symbol: 'BTCUSDT',
        limit: 500,
      },
      warehouse_data_range: { dataset: 'candles', symbol: 'BTCUSDT', interval: '1h' },
      warehouse_coverage: { dataset: 'candles', symbol: 'BTCUSDT', interval: '1h' },
    });

    expect(calls.map(([name]) => name)).toEqual([
      'importFile',
      'importUrl',
      'status',
      'listDatasets',
      'listFiles',
      'queryCandles',
      'queryTrades',
      'querySeries',
      'candleDataRange',
      'coverage',
    ]);
  });

  it('routes warehouse_coverage for tape and rejects a missing market or interval', async () => {
    const capture = new ToolCapture();
    const calls: Array<[string, unknown[]]> = [];
    const service = trackedService(calls) as Record<string, (...arguments_: unknown[]) => unknown>;
    registerWarehouseTools(capture as unknown as McpServer, service as unknown as WarehouseService);

    await invokeAll(capture, {
      warehouse_coverage: {
        dataset: 'aggtrades',
        market: 'um',
        symbol: 'BTCUSDT',
        startTime: '2026-09-01T00:00:00Z',
        endTime: '2026-09-17T23:59:59Z',
      },
    });
    expect(calls[0]).toEqual([
      'coverage',
      [
        { dataset: 'aggtrades', symbol: 'BTCUSDT', market: 'um' },
        { startTime: '2026-09-01T00:00:00Z', endTime: '2026-09-17T23:59:59Z' },
      ],
    ]);

    const handler = capture.handlers.get('warehouse_coverage')!;
    await expect(handler({ dataset: 'candles', symbol: 'BTCUSDT' })).resolves.toMatchObject({
      isError: true,
    });
    await expect(handler({ dataset: 'trades', symbol: 'BTCUSDT' })).resolves.toMatchObject({
      isError: true,
    });
  });

  it('routes warehouse_data_range requests for tape datasets and validates both branches', async () => {
    const capture = new ToolCapture();
    const calls: Array<[string, unknown[]]> = [];
    const service = trackedService(calls) as Record<string, (...arguments_: unknown[]) => unknown>;
    registerWarehouseTools(capture as unknown as McpServer, service as unknown as WarehouseService);

    await invokeAll(capture, {
      warehouse_data_range: {
        dataset: 'aggtrades',
        market: 'um',
        symbol: 'BTCUSDT',
        startTime: '2026-08-01T00:00:00Z',
        endTime: '2026-08-01T23:59:59Z',
      },
    });
    expect(calls.map(([name]) => name)).toEqual(['tapeDataRange']);
    // The window arrives as the second argument: without it the tool scans the symbol's
    // whole history.
    expect(calls[0]?.[1]).toEqual([
      { dataset: 'aggtrades', market: 'um', symbol: 'BTCUSDT' },
      { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-01T23:59:59Z' },
    ]);

    const rangeHandler = capture.handlers.get('warehouse_data_range')!;
    await expect(rangeHandler({ dataset: 'candles', symbol: 'BTCUSDT' })).resolves.toMatchObject({
      isError: true,
    });
    await expect(rangeHandler({ dataset: 'trades', symbol: 'BTCUSDT' })).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      rangeHandler({ dataset: 'trades', market: 'spot', symbol: 'BTCUSDT', interval: '1h' }),
    ).resolves.toMatchObject({ isError: true });
    // The candle branch keeps its original contract; a window would silently widen it.
    await expect(
      rangeHandler({
        dataset: 'candles',
        symbol: 'BTCUSDT',
        interval: '1h',
        startTime: '2026-08-01T00:00:00Z',
      }),
    ).resolves.toMatchObject({ isError: true });
  });

  it('converts service failures to MCP tool errors', async () => {
    const capture = new ToolCapture();
    registerMarketTools(
      capture as unknown as McpServer,
      {
        candles: async () => Promise.reject(new Error('upstream failed')),
      } as unknown as MarketAnalysisService,
    );

    await expect(
      capture.handlers.get('get_candles')!({ symbol: 'BTCUSDT', interval: '1h', limit: 200 }),
    ).resolves.toMatchObject({ isError: true });
  });
});
