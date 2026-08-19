import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('derives all stateful paths from BINANCE_RESEARCH_DATA_DIR', () => {
    const root = resolve('portable-data');
    const config = loadConfig({ BINANCE_RESEARCH_DATA_DIR: root });

    expect(config.BINANCE_RESEARCH_DATA_DIR).toBe(root);
    expect(config.BINANCE_CACHE_DB_PATH).toBe(join(root, 'cache', 'market-cache.sqlite'));
    expect(config.WAREHOUSE_PARQUET_ROOT).toBe(join(root, 'warehouse', 'parquet'));
    expect(config.WAREHOUSE_METADATA_DB_PATH).toBe(join(root, 'warehouse', 'metadata.sqlite'));
    expect(config.WAREHOUSE_TEMP_DIR).toBe(join(root, 'warehouse', 'tmp'));
    expect(config.WAREHOUSE_IMPORT_ROOTS).toBe(join(root, 'imports'));
  });

  it('keeps explicit per-path overrides for advanced deployments', () => {
    const firstImportRoot = resolve('first-import-root');
    const secondImportRoot = resolve('second-import-root');
    const explicitCache = resolve('explicit-cache.sqlite');
    const config = loadConfig({
      BINANCE_RESEARCH_DATA_DIR: resolve('portable-data'),
      BINANCE_CACHE_DB_PATH: explicitCache,
      WAREHOUSE_IMPORT_ROOTS: `${firstImportRoot}${delimiter}${secondImportRoot}`,
    });

    expect(config.BINANCE_CACHE_DB_PATH).toBe(explicitCache);
    expect(config.WAREHOUSE_IMPORT_ROOTS).toBe(`${firstImportRoot}${delimiter}${secondImportRoot}`);
  });

  it('rejects insecure endpoint overrides', () => {
    expect(() => loadConfig({ BINANCE_REST_BASE_URL: 'http://api.binance.test' })).toThrow(
      'Only HTTPS Binance endpoints are allowed.',
    );
    expect(() => loadConfig({ BINANCE_FUTURES_REST_BASE_URL: 'http://fapi.binance.test' })).toThrow(
      'Only HTTPS Binance endpoints are allowed.',
    );
  });

  it('accepts an external account profile path and bounds recvWindow', () => {
    const profilesPath = resolve('protected', 'binance-account-profiles.json');
    const config = loadConfig({
      BINANCE_ACCOUNT_PROFILES_PATH: profilesPath,
      BINANCE_ACCOUNT_RECV_WINDOW_MS: '4000',
    });

    expect(config.BINANCE_ACCOUNT_PROFILES_PATH).toBe(profilesPath);
    expect(config.BINANCE_ACCOUNT_RECV_WINDOW_MS).toBe(4000);
    expect(() => loadConfig({ BINANCE_ACCOUNT_RECV_WINDOW_MS: '60001' })).toThrow();
  });
});
