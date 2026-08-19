#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AccountApiClient } from './account/account-api-client.js';
import { AccountProfileStore } from './account/account-profile-store.js';
import { BinanceApiClient } from './binance/api-client.js';
import { BinanceFuturesApiClient } from './binance/futures-api-client.js';
import { createCache } from './cache/create-cache.js';
import { loadConfig } from './config.js';
import { registerAccountTools } from './mcp/register-account-tools.js';
import { registerMarketTools } from './mcp/register-tools.js';
import { registerFuturesTools } from './mcp/register-futures-tools.js';
import { registerWarehouseTools } from './mcp/register-warehouse-tools.js';
import { FuturesAnalysisService } from './services/futures-analysis-service.js';
import { AccountReadService } from './services/account-read-service.js';
import { MarketAnalysisService } from './services/market-analysis-service.js';
import { serverMetadata } from './server-metadata.js';
import { WarehouseService } from './warehouse/warehouse-service.js';

const config = loadConfig();
const cache = createCache(config);
const accountProfiles = new AccountProfileStore(config.BINANCE_ACCOUNT_PROFILES_PATH);
const accountService = new AccountReadService(
  accountProfiles,
  new AccountApiClient(config, accountProfiles),
);
const service = new MarketAnalysisService(new BinanceApiClient(config), cache, config);
const futuresService = new FuturesAnalysisService(
  new BinanceFuturesApiClient(config),
  cache,
  config,
);
const server = new McpServer(serverMetadata, {
  instructions:
    'Binance Spot and USD-M Futures research with public market data plus optional, explicitly configured read-only USER_DATA account profiles. No order placement, cancellation, leverage change, transfer, or withdrawal tools are available. Use account_profiles_status before private reads when configuration is uncertain, and select profileId explicitly when more than one profile can access a surface. Treat results as research, include data time, and never present analysis as guaranteed investment advice.',
});

registerMarketTools(server, service);
registerFuturesTools(server, futuresService);
registerAccountTools(server, accountService);
if (config.WAREHOUSE_ENABLED) {
  registerWarehouseTools(server, new WarehouseService(config));
}

const transport = new StdioServerTransport();
await server.connect(transport);
