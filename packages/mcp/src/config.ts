import { z } from 'zod';
import { derivedRuntimePaths, resolveDataDirectory } from './platform-paths.js';

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Only HTTPS Binance endpoints are allowed.',
  });

const environmentSchema = z.object({
  BINANCE_REST_BASE_URL: httpsUrl.default('https://api.binance.com'),
  BINANCE_FUTURES_REST_BASE_URL: httpsUrl.default('https://fapi.binance.com'),
  BINANCE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  BINANCE_CACHE_TTL_MS: z.coerce.number().int().nonnegative().max(60_000).default(15_000),
  BINANCE_CANDLE_CACHE_TTL_MS: z.coerce.number().int().nonnegative().max(3_600_000).default(60_000),
  BINANCE_FUNDING_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(86_400_000)
    .default(600_000),
  BINANCE_PERSISTENT_CACHE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  BINANCE_RESEARCH_DATA_DIR: z.string().trim().min(1).optional(),
  BINANCE_CACHE_DB_PATH: z.string().trim().min(1).optional(),
  BINANCE_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().max(1_000_000).default(10_000),
  WAREHOUSE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WAREHOUSE_PARQUET_ROOT: z.string().trim().min(1).optional(),
  WAREHOUSE_METADATA_DB_PATH: z.string().trim().min(1).optional(),
  WAREHOUSE_TEMP_DIR: z.string().trim().min(1).optional(),
  WAREHOUSE_IMPORT_ROOTS: z.string().trim().min(1).optional(),
  WAREHOUSE_MAX_IMPORT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024 * 1024)
    .default(512 * 1024 * 1024),
  WAREHOUSE_DOWNLOAD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(10 * 60_000)
    .default(120_000),
});

type ParsedEnvironment = z.infer<typeof environmentSchema>;

export type AppConfig = Omit<
  ParsedEnvironment,
  | 'BINANCE_RESEARCH_DATA_DIR'
  | 'BINANCE_CACHE_DB_PATH'
  | 'WAREHOUSE_PARQUET_ROOT'
  | 'WAREHOUSE_METADATA_DB_PATH'
  | 'WAREHOUSE_TEMP_DIR'
  | 'WAREHOUSE_IMPORT_ROOTS'
> & {
  BINANCE_RESEARCH_DATA_DIR: string;
  BINANCE_CACHE_DB_PATH: string;
  WAREHOUSE_PARQUET_ROOT: string;
  WAREHOUSE_METADATA_DB_PATH: string;
  WAREHOUSE_TEMP_DIR: string;
  WAREHOUSE_IMPORT_ROOTS: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const dataDirectory = resolveDataDirectory(parsed.BINANCE_RESEARCH_DATA_DIR, environment);
  const derived = derivedRuntimePaths(dataDirectory);
  return {
    ...parsed,
    BINANCE_RESEARCH_DATA_DIR: dataDirectory,
    BINANCE_CACHE_DB_PATH: parsed.BINANCE_CACHE_DB_PATH ?? derived.cacheDatabasePath,
    WAREHOUSE_PARQUET_ROOT: parsed.WAREHOUSE_PARQUET_ROOT ?? derived.warehouseParquetRoot,
    WAREHOUSE_METADATA_DB_PATH:
      parsed.WAREHOUSE_METADATA_DB_PATH ?? derived.warehouseMetadataDatabasePath,
    WAREHOUSE_TEMP_DIR: parsed.WAREHOUSE_TEMP_DIR ?? derived.warehouseTempDirectory,
    WAREHOUSE_IMPORT_ROOTS: parsed.WAREHOUSE_IMPORT_ROOTS ?? derived.warehouseImportRoots,
  };
}
