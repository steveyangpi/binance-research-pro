import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { FuturesAnalysisService } from '../services/futures-analysis-service.js';
import { jsonOutputSchema, jsonResult, toolError } from './formatters.js';
import { candleLimitSchema, intervalSchema, symbolSchema } from './schemas.js';

const publicReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerFuturesTools(server: McpServer, service: FuturesAnalysisService): void {
  server.registerTool(
    'futures_market_overview',
    {
      title: 'Get USD-M Futures overview',
      description:
        'Get Binance USD-M perpetual-futures 24-hour statistics for one symbol or the most liquid USDT contracts.',
      inputSchema: { symbol: symbolSchema.optional() },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol }) => {
      try {
        const tickers = await service.marketOverview(symbol);
        const filtered =
          symbol === undefined
            ? tickers.filter((ticker) => ticker.symbol.endsWith('USDT'))
            : tickers;
        return jsonResult(
          filtered.sort((left, right) => right.quoteVolume - left.quoteVolume).slice(0, 30),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_mark_price',
    {
      title: 'Get Futures mark price',
      description:
        'Get USD-M Futures mark price, index price, basis, current funding rate and next funding time.',
      inputSchema: { symbol: symbolSchema },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol }) => {
      try {
        return jsonResult(await service.markPrice(symbol));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_candles',
    {
      title: 'Get Futures candlesticks',
      description: 'Get normalized Binance USD-M Futures candlesticks (OHLCV).',
      inputSchema: { symbol: symbolSchema, interval: intervalSchema, limit: candleLimitSchema },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol, interval, limit }) => {
      try {
        return jsonResult(await service.candles(symbol, interval, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_order_book_snapshot',
    {
      title: 'Get Futures order book',
      description:
        'Get a USD-M Futures order-book snapshot and calculate spread and notional imbalance.',
      inputSchema: { symbol: symbolSchema, limit: z.number().int().min(5).max(1000).default(100) },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol, limit }) => {
      try {
        return jsonResult(await service.orderBookSummary(symbol, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_open_interest',
    {
      title: 'Get Futures open interest',
      description: 'Get current Binance USD-M Futures open interest for one contract.',
      inputSchema: { symbol: symbolSchema },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol }) => {
      try {
        return jsonResult(await service.openInterest(symbol));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_funding_rate',
    {
      title: 'Get Futures funding history',
      description:
        'Get historical Binance USD-M Futures funding rates; rates are returned as decimals and percentages.',
      inputSchema: { symbol: symbolSchema, limit: z.number().int().min(1).max(1000).default(20) },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol, limit }) => {
      try {
        return jsonResult(await service.fundingRateHistory(symbol, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'analyze_futures',
    {
      title: 'Analyze USD-M Futures',
      description:
        'Analyze USD-M perpetual-futures price, mark/index basis, funding, open interest and technical indicators.',
      inputSchema: {
        symbol: symbolSchema,
        interval: intervalSchema.default('1h'),
        limit: candleLimitSchema,
      },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol, interval, limit }) => {
      try {
        return jsonResult(await service.analyze(symbol, interval, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
