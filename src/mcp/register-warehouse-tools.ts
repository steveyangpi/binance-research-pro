import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WarehouseImportRequest } from '../warehouse/types.js';
import type { WarehouseService } from '../warehouse/warehouse-service.js';
import { jsonOutputSchema, jsonResult, toolError } from './formatters.js';

const partitionValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const profileSchema = z.enum(['binance-kline', 'generic-csv', 'parquet']);
const checksumSchema = z
  .string()
  .trim()
  .regex(/^[A-Fa-f0-9]{64}$/);
const importMetadataSchema = {
  dataset: partitionValueSchema.describe('Logical dataset name, for example candles.'),
  source: partitionValueSchema.describe('Provenance label, for example binance-public-data.'),
  profile: profileSchema.describe('Input layout and conversion profile.'),
  market: partitionValueSchema.optional().describe('Optional market label such as spot or um.'),
  symbol: partitionValueSchema.optional().describe('Required by binance-kline, e.g. BTCUSDT.'),
  interval: partitionValueSchema.optional().describe('Required by binance-kline, e.g. 1h.'),
  hasHeader: z
    .boolean()
    .optional()
    .describe('Whether generic CSV contains a header; default true.'),
  zipEntry: z.string().trim().min(1).max(500).optional().describe('CSV entry name in a ZIP.'),
  expectedSha256: checksumSchema.optional().describe('Optional expected SHA-256 checksum.'),
};
const candleSelectionSchema = {
  dataset: partitionValueSchema.default('candles'),
  source: partitionValueSchema.optional(),
  market: partitionValueSchema.optional(),
  symbol: partitionValueSchema.transform((value) => value.toUpperCase()),
  interval: partitionValueSchema,
};

type ImportToolInput = WarehouseImportRequest & {
  market: string | undefined;
  symbol: string | undefined;
  interval: string | undefined;
  hasHeader: boolean | undefined;
  zipEntry: string | undefined;
  expectedSha256: string | undefined;
};

const localReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const localWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const remoteImportAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

function compactImportMetadata(input: ImportToolInput): WarehouseImportRequest {
  return {
    dataset: input.dataset,
    source: input.source,
    profile: input.profile,
    ...(input.market === undefined ? {} : { market: input.market }),
    ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    ...(input.interval === undefined ? {} : { interval: input.interval }),
    ...(input.hasHeader === undefined ? {} : { hasHeader: input.hasHeader }),
    ...(input.zipEntry === undefined ? {} : { zipEntry: input.zipEntry }),
    ...(input.expectedSha256 === undefined ? {} : { expectedSha256: input.expectedSha256 }),
  };
}

/** Register local data-lake tools separately from Binance REST analysis tools. */
export function registerWarehouseTools(server: McpServer, warehouse: WarehouseService): void {
  server.registerTool(
    'warehouse_import_file',
    {
      title: 'Import a local market-data file',
      description:
        'Import an allowed local CSV, ZIP or Parquet file into the configurable Parquet warehouse. The path must be inside WAREHOUSE_IMPORT_ROOTS.',
      inputSchema: { path: z.string().trim().min(1), ...importMetadataSchema },
      outputSchema: jsonOutputSchema,
      annotations: localWriteAnnotations,
    },
    async ({ path, ...metadata }) => {
      try {
        return jsonResult(
          await warehouse.importFile({
            path,
            ...compactImportMetadata(metadata as ImportToolInput),
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'warehouse_import_url',
    {
      title: 'Import a remote market-data file',
      description:
        'Download an HTTPS CSV, ZIP or Parquet file, verify it when a checksum is supplied, and import it into the Parquet warehouse.',
      inputSchema: { url: z.string().url(), ...importMetadataSchema },
      outputSchema: jsonOutputSchema,
      annotations: remoteImportAnnotations,
    },
    async ({ url, ...metadata }) => {
      try {
        return jsonResult(
          await warehouse.importUrl({ url, ...compactImportMetadata(metadata as ImportToolInput) }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'warehouse_status',
    {
      title: 'Get warehouse status',
      description:
        'Show configured warehouse paths, safety limits and aggregate import statistics.',
      inputSchema: {},
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    () => jsonResult(warehouse.status()),
  );

  server.registerTool(
    'warehouse_list_datasets',
    {
      title: 'List warehouse datasets',
      description:
        'List imported datasets, sources, symbols, intervals, row counts and time ranges.',
      inputSchema: {},
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    () => jsonResult(warehouse.listDatasets()),
  );

  server.registerTool(
    'warehouse_list_files',
    {
      title: 'List warehouse files',
      description: 'List registered Parquet files with optional metadata filters.',
      inputSchema: {
        dataset: partitionValueSchema.optional(),
        source: partitionValueSchema.optional(),
        symbol: partitionValueSchema.optional(),
        interval: partitionValueSchema.optional(),
        limit: z.number().int().min(1).max(1000).default(100),
      },
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    ({ dataset, source, symbol, interval, limit }) =>
      jsonResult(
        warehouse.listFiles({
          limit,
          ...(dataset === undefined ? {} : { dataset }),
          ...(source === undefined ? {} : { source }),
          ...(symbol === undefined ? {} : { symbol: symbol.toUpperCase() }),
          ...(interval === undefined ? {} : { interval }),
        }),
      ),
  );

  server.registerTool(
    'warehouse_query_candles',
    {
      title: 'Query historical candlesticks',
      description:
        'Query deduplicated Binance Kline records from imported Parquet files, newest first.',
      inputSchema: {
        ...candleSelectionSchema,
        startTime: z.string().datetime({ offset: true }).optional(),
        endTime: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    async ({ dataset, source, market, symbol, interval, startTime, endTime, limit }) => {
      try {
        return jsonResult(
          await warehouse.queryCandles({
            dataset,
            symbol,
            interval,
            limit,
            ...(source === undefined ? {} : { source }),
            ...(market === undefined ? {} : { market }),
            ...(startTime === undefined ? {} : { startTime }),
            ...(endTime === undefined ? {} : { endTime }),
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'warehouse_data_range',
    {
      title: 'Get historical data range',
      description:
        'Return deduplicated row count and earliest/latest open time for imported Binance Klines.',
      inputSchema: candleSelectionSchema,
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    async ({ dataset, source, market, symbol, interval }) => {
      try {
        return jsonResult(
          await warehouse.candleDataRange({
            dataset,
            symbol,
            interval,
            ...(source === undefined ? {} : { source }),
            ...(market === undefined ? {} : { market }),
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
