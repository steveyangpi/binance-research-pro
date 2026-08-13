#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BinanceApiClient } from './binance/api-client.js';
import { BinanceFuturesApiClient } from './binance/futures-api-client.js';
import { createCache } from './cache/create-cache.js';
import { loadConfig } from './config.js';
import { registerMarketTools } from './mcp/register-tools.js';
import { registerFuturesTools } from './mcp/register-futures-tools.js';
import { registerWarehouseTools } from './mcp/register-warehouse-tools.js';
import { FuturesAnalysisService } from './services/futures-analysis-service.js';
import { MarketAnalysisService } from './services/market-analysis-service.js';
import { serverMetadata } from './server-metadata.js';
import { WarehouseService } from './warehouse/warehouse-service.js';

const config = loadConfig();
const cache = createCache(config);
const service = new MarketAnalysisService(new BinanceApiClient(config), cache, config);
const futuresService = new FuturesAnalysisService(
  new BinanceFuturesApiClient(config),
  cache,
  config,
);
const server = new McpServer(serverMetadata, {
  instructions:
    'Public Binance Spot and USD-M Futures research only. No API key, account access, order placement, transfer, or withdrawal tools are available. Prefer compare_markets for multi-symbol comparisons and multi_timeframe_analysis for cross-timeframe trend questions. Treat all results as market-data research, include the data time, and never present analysis as guaranteed investment advice.',
});

registerMarketTools(server, service);
registerFuturesTools(server, futuresService);
if (config.WAREHOUSE_ENABLED) {
  registerWarehouseTools(server, new WarehouseService(config));
}

const transport = new StdioServerTransport();
await server.connect(transport);
