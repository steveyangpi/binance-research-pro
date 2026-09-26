import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WarehouseImportRequest } from '../warehouse/types.js';
import { isTapeDataset } from '../warehouse/types.js';
import type { WarehouseService } from '../warehouse/warehouse-service.js';
import { jsonOutputSchema, jsonResult, toolError } from './formatters.js';

const partitionValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const profileSchema = z.enum([
  'binance-kline',
  'binance-trades',
  'binance-agg-trades',
  'binance-metrics',
  'binance-book-depth',
  'generic-csv',
  'parquet',
]);
const checksumSchema = z
  .string()
  .trim()
  .regex(/^[A-Fa-f0-9]{64}$/);
const marketSchema = z.enum(['spot', 'um']);
const importMetadataSchema = {
  dataset: partitionValueSchema.describe(
    'Logical dataset name. Use candles, trades / aggtrades for tick data, or ' +
      'metrics / bookdepth for USD-M snapshot series.',
  ),
  source: partitionValueSchema.describe('Provenance label, for example binance-public-data.'),
  profile: profileSchema.describe('Input layout and conversion profile.'),
  market: partitionValueSchema
    .optional()
    .describe(
      'Optional market label such as spot or um. binance-trades and binance-agg-trades ' +
        "require 'spot' or 'um'.",
    ),
  symbol: partitionValueSchema.optional().describe('Required by binance-kline, e.g. BTCUSDT.'),
  interval: partitionValueSchema
    .optional()
    .describe('Required by binance-kline, e.g. 1h. Rejected by the tape profiles.'),
  hasHeader: z
    .boolean()
    .optional()
    .describe('Whether generic CSV contains a header; default true. Rejected by tape profiles.'),
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
/** `interval` becomes optional here so one tool can serve candles and tape. */
const rangeSelectionSchema = {
  dataset: partitionValueSchema.default('candles'),
  source: partitionValueSchema.optional(),
  market: partitionValueSchema.optional().describe('Required for tape datasets.'),
  symbol: partitionValueSchema.transform((value) => value.toUpperCase()),
  interval: partitionValueSchema
    .optional()
    .describe('Required for candles. Rejected for tape datasets.'),
  startTime: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Tape datasets only: bound the range to a window. Without one the range covers the ' +
        'whole history for the symbol and scans every file, which is the slowest query here.',
    ),
  endTime: z.string().datetime({ offset: true }).optional(),
};
const tapeSelectionSchema = {
  dataset: z.enum(['trades', 'aggtrades']).default('trades'),
  source: partitionValueSchema.optional(),
  market: marketSchema,
  symbol: partitionValueSchema.transform((value) => value.toUpperCase()),
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
        market: partitionValueSchema
          .optional()
          .describe('Optional market filter; spot and um share symbol names.'),
        symbol: partitionValueSchema.optional(),
        interval: partitionValueSchema.optional(),
        limit: z.number().int().min(1).max(1000).default(100),
      },
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    ({ dataset, source, market, symbol, interval, limit }) =>
      jsonResult(
        warehouse.listFiles({
          limit,
          ...(dataset === undefined ? {} : { dataset }),
          ...(source === undefined ? {} : { source }),
          ...(market === undefined ? {} : { market }),
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
    'warehouse_query_trades',
    {
      title: 'Query historical trades or aggregate trades',
      description:
        'Query deduplicated Binance trade records from imported Parquet files. Set bucketSeconds ' +
        'to aggregate into time buckets (trade count, volume, VWAP, taker buy/sell split, net ' +
        'taker delta, large-order counts, and CVD) instead of returning raw rows. Use ' +
        'minNotional to isolate large aggressive orders, minSpan for sweeps, minPrice and ' +
        'maxPrice to scope the whole query to a price band, and groupBy=price ' +
        'for a footprint view per price level. Note that aggregate trades carry no quote ' +
        'quantity, so quote volume and VWAP are derived from price times quantity, and that ' +
        'CVD is anchored to the start of the requested window, so it is not comparable across ' +
        'windows with different start times.',
      inputSchema: {
        ...tapeSelectionSchema,
        startTime: z.string().datetime({ offset: true }).optional(),
        endTime: z.string().datetime({ offset: true }).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(500)
          .describe('Maximum rows, or maximum buckets when bucketSeconds is set.'),
        bucketSeconds: z
          .number()
          .int()
          .min(1)
          .max(86400)
          .optional()
          .describe('Aggregate into buckets of this many seconds instead of returning rows.'),
        minNotional: z
          .number()
          .nonnegative()
          .optional()
          .describe(
            'Only return trades whose price times quantity is at or above this notional. ' +
              'Defaults to 0, in which case the large-order bucket columns repeat the bucket ' +
              'totals. A useful floor for a major pair is around 100000.',
          ),
        minSpan: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Only return aggregate trades whose aggressor order consumed at least this many ' +
              'resting orders. Available for aggtrades only; raw trades have no span.',
          ),
        groupBy: z
          .literal('price')
          .optional()
          .describe(
            'Footprint view: one row per price level with the taker buy/sell split, net ' +
              'delta, hit count, and the time span over which the level was hit. Requires ' +
              'bucketSeconds plus both startTime and endTime.',
          ),
        minPrice: z
          .number()
          .nonnegative()
          .optional()
          .describe(
            'Lower bound of a price band. Unlike minNotional this scopes the whole query, ' +
              'so every aggregate and bucket describes trades inside the band only.',
          ),
        maxPrice: z
          .number()
          .nonnegative()
          .optional()
          .describe('Upper bound of the price band. See minPrice.'),
      },
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    async ({
      dataset,
      source,
      market,
      symbol,
      startTime,
      endTime,
      limit,
      bucketSeconds,
      minNotional,
      minSpan,
      groupBy,
      minPrice,
      maxPrice,
    }) => {
      try {
        return jsonResult(
          await warehouse.queryTrades({
            dataset,
            market,
            symbol,
            limit,
            ...(source === undefined ? {} : { source }),
            ...(startTime === undefined ? {} : { startTime }),
            ...(endTime === undefined ? {} : { endTime }),
            ...(bucketSeconds === undefined ? {} : { bucketSeconds }),
            ...(minNotional === undefined ? {} : { minNotional }),
            ...(minSpan === undefined ? {} : { minSpan }),
            ...(groupBy === undefined ? {} : { groupBy }),
            ...(minPrice === undefined ? {} : { minPrice }),
            ...(maxPrice === undefined ? {} : { maxPrice }),
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'warehouse_query_series',
    {
      title: 'Query USD-M snapshot series',
      description:
        'Query imported USD-M snapshot datasets, which Binance publishes without a spot ' +
        'counterpart. "metrics" is 5-minute open interest plus long/short and taker-volume ' +
        'ratios; "bookdepth" is a 30-second snapshot of cumulative depth inside signed ' +
        'percentage bands, not a per-level order book. Set bucketSeconds to average each ' +
        'value per bucket; book depth keeps its percentage band separate.',
      inputSchema: {
        dataset: z.enum(['metrics', 'bookdepth']),
        source: partitionValueSchema.optional(),
        symbol: partitionValueSchema.transform((value) => value.toUpperCase()),
        startTime: z.string().datetime({ offset: true }).optional(),
        endTime: z.string().datetime({ offset: true }).optional(),
        percentage: z
          .number()
          .optional()
          .describe(
            'bookdepth only: one signed band such as -0.2 (bid side) or 1 (ask side). ' +
              'Omit to return every band.',
          ),
        bucketSeconds: z.number().int().min(1).max(86400).optional(),
        limit: z.number().int().min(1).max(5000).default(500),
      },
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    async ({ dataset, source, symbol, startTime, endTime, percentage, bucketSeconds, limit }) => {
      try {
        return jsonResult(
          await warehouse.querySeries({
            dataset,
            market: 'um',
            symbol,
            limit,
            ...(source === undefined ? {} : { source }),
            ...(startTime === undefined ? {} : { startTime }),
            ...(endTime === undefined ? {} : { endTime }),
            ...(percentage === undefined ? {} : { percentage }),
            ...(bucketSeconds === undefined ? {} : { bucketSeconds }),
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
        'Return deduplicated row count and earliest/latest time for imported Klines, trades or ' +
        'aggregate trades. Tape datasets accept startTime and endTime to bound the range; ' +
        'without them the result spans the whole history for the symbol and every file is ' +
        'scanned.',
      inputSchema: rangeSelectionSchema,
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    async ({ dataset, source, market, symbol, interval, startTime, endTime }) => {
      try {
        if (!isTapeDataset(dataset)) {
          if (interval === undefined) {
            throw new Error('warehouse_data_range requires interval for the candles dataset.');
          }
          if (startTime !== undefined || endTime !== undefined) {
            throw new Error(
              'warehouse_data_range accepts startTime and endTime for tape datasets only.',
            );
          }
          return jsonResult(
            await warehouse.candleDataRange({
              dataset,
              symbol,
              interval,
              ...(source === undefined ? {} : { source }),
              ...(market === undefined ? {} : { market }),
            }),
          );
        }
        if (market === undefined) {
          throw new Error(`warehouse_data_range requires market for the ${dataset} dataset.`);
        }
        if (interval !== undefined) {
          throw new Error(
            `warehouse_data_range does not accept interval for the ${dataset} dataset.`,
          );
        }
        return jsonResult(
          await warehouse.tapeDataRange(
            {
              dataset,
              market,
              symbol,
              ...(source === undefined ? {} : { source }),
            },
            {
              ...(startTime === undefined ? {} : { startTime }),
              ...(endTime === undefined ? {} : { endTime }),
            },
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'warehouse_coverage',
    {
      title: 'Check historical day coverage',
      description:
        'Report which UTC days of a dataset are actually imported and which are missing. ' +
        'Derived from file time bounds, so it reads no parquet payload. Use it before a ' +
        'multi-day analysis: a min/max range looks continuous even when whole days in the ' +
        'middle were never imported, and this is what exposes that gap. A day with any ' +
        'data counts as covered; pair it with warehouse_data_range to judge how complete ' +
        'each day is.',
      inputSchema: rangeSelectionSchema,
      outputSchema: jsonOutputSchema,
      annotations: localReadAnnotations,
    },
    async ({ dataset, source, market, symbol, interval, startTime, endTime }) => {
      try {
        if (!isTapeDataset(dataset) && interval === undefined) {
          throw new Error('warehouse_coverage requires interval for the candles dataset.');
        }
        if (isTapeDataset(dataset) && market === undefined) {
          throw new Error(`warehouse_coverage requires market for the ${dataset} dataset.`);
        }
        return jsonResult(
          warehouse.coverage(
            {
              dataset,
              symbol,
              ...(source === undefined ? {} : { source }),
              ...(market === undefined ? {} : { market }),
              ...(interval === undefined ? {} : { interval }),
            },
            {
              ...(startTime === undefined ? {} : { startTime }),
              ...(endTime === undefined ? {} : { endTime }),
            },
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
