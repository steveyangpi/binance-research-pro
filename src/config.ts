import { z } from 'zod';

const environmentSchema = z.object({
  BINANCE_REST_BASE_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_FUTURES_REST_BASE_URL: z.string().url().default('https://fapi.binance.com'),
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
  BINANCE_CACHE_DB_PATH: z.string().trim().min(1).default('./data/binance-analysis-cache.sqlite'),
  BINANCE_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().max(1_000_000).default(10_000),
  WAREHOUSE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WAREHOUSE_PARQUET_ROOT: z.string().trim().min(1).default('./data/warehouse/parquet'),
  WAREHOUSE_METADATA_DB_PATH: z.string().trim().min(1).default('./data/warehouse/metadata.sqlite'),
  WAREHOUSE_TEMP_DIR: z.string().trim().min(1).default('./data/warehouse/tmp'),
  WAREHOUSE_IMPORT_ROOTS: z.string().trim().min(1).default('./imports'),
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

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(environment);
}
