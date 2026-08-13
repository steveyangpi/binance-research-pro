import type { AppConfig } from '../config.js';
import type { CacheStore } from './cache-store.js';
import { SqliteCache } from './sqlite-cache.js';
import { TtlCache } from './ttl-cache.js';

export function createCache(config: AppConfig): CacheStore {
  if (!config.BINANCE_PERSISTENT_CACHE_ENABLED) return new TtlCache();
  return new SqliteCache(config.BINANCE_CACHE_DB_PATH, config.BINANCE_CACHE_MAX_ENTRIES);
}
