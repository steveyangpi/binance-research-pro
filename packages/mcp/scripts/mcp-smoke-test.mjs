import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'account_profiles_status',
  'analyze_futures',
  'analyze_indicators',
  'analyze_trend',
  'compare_markets',
  'exchange_info',
  'futures_candles',
  'futures_funding_rate',
  'futures_income_history',
  'futures_mark_price',
  'futures_market_overview',
  'futures_open_interest',
  'futures_open_orders',
  'futures_order_book_snapshot',
  'futures_positions',
  'get_candles',
  'market_overview',
  'multi_timeframe_analysis',
  'order_book_snapshot',
  'spot_account_overview',
  'warehouse_data_range',
  'warehouse_import_file',
  'warehouse_import_url',
  'warehouse_list_datasets',
  'warehouse_list_files',
  'warehouse_query_candles',
  'warehouse_status',
];
const serverEntry = process.env.MCP_TEST_SERVER_ENTRY
  ? resolve(process.env.MCP_TEST_SERVER_ENTRY)
  : fileURLToPath(new URL('../dist/index.js', import.meta.url));
const serverCommand = process.env.MCP_TEST_COMMAND ?? process.execPath;
const serverArguments = process.env.MCP_TEST_ARGS_JSON
  ? JSON.parse(process.env.MCP_TEST_ARGS_JSON)
  : [serverEntry];
// The MCP SDK intentionally inherits only a safe subset of the parent environment.
// Forward this server's documented configuration so smoke tests match desktop startup.
const serverEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) =>
      value !== undefined && (name.startsWith('BINANCE_') || name.startsWith('WAREHOUSE_')),
  ),
);
// The default handshake must be deterministic on machines that have real account profiles.
// Authenticated behavior is covered by isolated unit tests and explicit manual live checks.
delete serverEnvironment.BINANCE_ACCOUNT_PROFILES_PATH;
Object.assign(serverEnvironment, getDefaultEnvironment());
const transport = new StdioClientTransport({
  command: serverCommand,
  args: serverArguments,
  env: serverEnvironment,
  stderr: 'inherit',
});
const client = new Client({ name: 'binance-research-pro-smoke-test', version: '0.1.0' });

try {
  await client.connect(transport);
  const response = await client.listTools();
  const actualTools = response.tools.map((tool) => tool.name).sort();

  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected tool list: ${actualTools.join(', ')}`);
  }
  console.log(`MCP handshake passed. Tools: ${actualTools.join(', ')}`);

  const warehouseStatus = await client.callTool({ name: 'warehouse_status', arguments: {} });
  if (warehouseStatus.isError) throw new Error('warehouse_status returned an MCP tool error');
  const warehouseText = warehouseStatus.content.find((item) => item.type === 'text')?.text;
  const warehouse = warehouseText === undefined ? undefined : JSON.parse(warehouseText);
  if (warehouse?.enabled !== true || typeof warehouse?.parquetRoot !== 'string') {
    throw new Error('warehouse_status returned an unexpected payload');
  }
  console.log(`Warehouse MCP call passed. Parquet root: ${warehouse.parquetRoot}`);

  const accountStatus = await client.callTool({
    name: 'account_profiles_status',
    arguments: {},
  });
  if (accountStatus.isError) throw new Error('account_profiles_status returned an MCP tool error');
  const accountStatusText = accountStatus.content.find((item) => item.type === 'text')?.text;
  const accounts = accountStatusText === undefined ? undefined : JSON.parse(accountStatusText);
  if (accounts?.configured !== false || !Array.isArray(accounts?.profiles)) {
    throw new Error('account_profiles_status returned an unexpected default payload');
  }
  console.log('Account profile MCP call passed without configured credentials.');

  const toolsByName = new Map(response.tools.map((tool) => [tool.name, tool]));
  for (const tool of response.tools) {
    if (
      tool.inputSchema === undefined ||
      tool.outputSchema === undefined ||
      tool.annotations === undefined
    ) {
      throw new Error(`${tool.name} is missing an MCP schema or safety annotations`);
    }
  }

  const publicReadTools = expectedTools.filter(
    (name) => !name.startsWith('warehouse_') && name !== 'account_profiles_status',
  );
  const localReadTools = expectedTools.filter(
    (name) =>
      name === 'account_profiles_status' ||
      (name.startsWith('warehouse_') &&
        !['warehouse_import_file', 'warehouse_import_url'].includes(name)),
  );
  for (const name of publicReadTools) {
    const annotations = toolsByName.get(name)?.annotations;
    if (annotations?.readOnlyHint !== true || annotations.openWorldHint !== true) {
      throw new Error(`${name} must be a read-only public-network tool`);
    }
  }
  for (const name of localReadTools) {
    const annotations = toolsByName.get(name)?.annotations;
    if (annotations?.readOnlyHint !== true || annotations.openWorldHint !== false) {
      throw new Error(`${name} must be a read-only local warehouse tool`);
    }
  }
  for (const [name, openWorldHint] of [
    ['warehouse_import_file', false],
    ['warehouse_import_url', true],
  ]) {
    const annotations = toolsByName.get(name)?.annotations;
    if (annotations?.readOnlyHint !== false || annotations.openWorldHint !== openWorldHint) {
      throw new Error(`${name} has incorrect state-change safety annotations`);
    }
  }

  if (process.argv.includes('--live')) {
    const result = await client.callTool({
      name: 'market_overview',
      arguments: { symbol: 'BTCUSDT' },
    });
    if (result.isError) throw new Error('Live market_overview call returned an MCP tool error');
    console.log('Live Binance call passed for BTCUSDT.');

    const futuresResult = await client.callTool({
      name: 'futures_market_overview',
      arguments: { symbol: 'KORUUSDT' },
    });
    if (futuresResult.isError) {
      throw new Error('Live futures_market_overview call returned an MCP tool error');
    }
    console.log('Live Binance Futures call passed for KORUUSDT.');
  }
} finally {
  await client.close();
}
