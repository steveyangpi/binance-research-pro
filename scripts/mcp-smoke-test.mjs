import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'analyze_futures',
  'analyze_indicators',
  'analyze_trend',
  'compare_markets',
  'exchange_info',
  'futures_candles',
  'futures_funding_rate',
  'futures_mark_price',
  'futures_market_overview',
  'futures_open_interest',
  'futures_order_book_snapshot',
  'get_candles',
  'market_overview',
  'multi_timeframe_analysis',
  'order_book_snapshot',
  'warehouse_data_range',
  'warehouse_import_file',
  'warehouse_import_url',
  'warehouse_list_datasets',
  'warehouse_list_files',
  'warehouse_query_candles',
  'warehouse_status',
];
const serverEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
// The MCP SDK intentionally inherits only a safe subset of the parent environment.
// Forward this server's documented configuration so smoke tests match desktop startup.
const serverEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) =>
      value !== undefined && (name.startsWith('BINANCE_') || name.startsWith('WAREHOUSE_')),
  ),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: serverEnvironment,
  stderr: 'pipe',
});
const client = new Client({ name: 'binance-analysis-smoke-test', version: '0.1.0' });

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

  const marketOverviewTool = response.tools.find((tool) => tool.name === 'market_overview');
  if (
    marketOverviewTool?.outputSchema === undefined ||
    marketOverviewTool.annotations?.readOnlyHint !== true ||
    marketOverviewTool.annotations?.openWorldHint !== true
  ) {
    throw new Error('market_overview is missing its output schema or safety annotations');
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
