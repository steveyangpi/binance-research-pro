import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MarketAnalysisService } from '../services/market-analysis-service.js';
import { jsonOutputSchema, jsonResult, toolError } from './formatters.js';
import {
  candleLimitSchema,
  intervalSchema,
  intervalsSchema,
  symbolSchema,
  symbolsSchema,
} from './schemas.js';

const publicReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerMarketTools(server: McpServer, service: MarketAnalysisService): void {
  server.registerTool(
    'market_overview',
    {
      title: 'Get Spot market overview',
      description:
        'Get Binance Spot 24-hour market statistics for one symbol or the most liquid USDT pairs.',
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
    'get_candles',
    {
      title: 'Get Spot candlesticks',
      description: 'Get normalized Binance Spot candlesticks (OHLCV).',
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
    'analyze_indicators',
    {
      title: 'Analyze Spot indicators',
      description:
        'Calculate SMA-20, EMA-20, RSI-14, MACD, Bollinger Bands and ATR-14 from Binance K-lines.',
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
        return jsonResult(await service.indicatorAnalysis(symbol, interval, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'analyze_trend',
    {
      title: 'Analyze Spot trend',
      description:
        'Summarize a single-timeframe trend and momentum state from public market data; it is not a trading recommendation.',
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
        return jsonResult(await service.trendAnalysis(symbol, interval, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'order_book_snapshot',
    {
      title: 'Get Spot order book',
      description: 'Get a public order-book snapshot and calculate spread and notional imbalance.',
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
    'exchange_info',
    {
      title: 'Get Spot exchange rules',
      description:
        'Get official Binance Spot symbol status, precision, order types and trading filters.',
      inputSchema: { symbol: symbolSchema },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol }) => {
      try {
        return jsonResult(await service.exchangeInfo(symbol));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'compare_markets',
    {
      title: 'Compare Spot markets',
      description: 'Compare normalized Binance Spot 24-hour statistics for 2 to 20 symbols.',
      inputSchema: { symbols: symbolsSchema },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbols }) => {
      try {
        return jsonResult(await service.compareMarkets(symbols));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'multi_timeframe_analysis',
    {
      title: 'Analyze multiple Spot timeframes',
      description:
        'Analyze a Spot symbol across 2 to 5 distinct K-line intervals and report trend alignment.',
      inputSchema: { symbol: symbolSchema, intervals: intervalsSchema, limit: candleLimitSchema },
      outputSchema: jsonOutputSchema,
      annotations: publicReadAnnotations,
    },
    async ({ symbol, intervals, limit }) => {
      try {
        return jsonResult(await service.multiTimeframeAnalysis(symbol, intervals, limit));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
