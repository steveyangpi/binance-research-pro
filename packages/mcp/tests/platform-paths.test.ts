import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultDataDirectory,
  derivedRuntimePaths,
  parsePathList,
  resolveDataDirectory,
} from '../src/platform-paths.js';

describe('platform runtime paths', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    expect(
      defaultDataDirectory(
        { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
        'win32',
        'C:\\Users\\Ada',
      ),
    ).toBe(resolve('C:\\Users\\Ada\\AppData\\Local', 'BinanceResearchPro'));
  });

  it('uses the standard macOS application support directory', () => {
    expect(defaultDataDirectory({ HOME: '/Users/ada' }, 'darwin', '/Users/ada')).toBe(
      resolve('/Users/ada/Library/Application Support/BinanceResearchPro'),
    );
  });

  it('uses XDG_DATA_HOME on Linux', () => {
    expect(defaultDataDirectory({ XDG_DATA_HOME: '/var/lib/ada' }, 'linux', '/home/ada')).toBe(
      resolve('/var/lib/ada/binance-research-pro'),
    );
  });

  it('lets BINANCE_RESEARCH_DATA_DIR override the platform default', () => {
    expect(resolveDataDirectory('./custom-data', {}, 'linux', '/home/ada')).toBe(
      resolve('./custom-data'),
    );
  });

  it('derives every runtime store from one data directory', () => {
    const root = resolve('runtime-data');
    expect(derivedRuntimePaths(root)).toEqual({
      cacheDatabasePath: join(root, 'cache', 'market-cache.sqlite'),
      warehouseParquetRoot: join(root, 'warehouse', 'parquet'),
      warehouseMetadataDatabasePath: join(root, 'warehouse', 'metadata.sqlite'),
      warehouseTempDirectory: join(root, 'warehouse', 'tmp'),
      warehouseImportRoots: join(root, 'imports'),
    });
  });

  it('parses platform-specific import-root lists', () => {
    expect(parsePathList(`first${delimiter}second`)).toEqual([resolve('first'), resolve('second')]);
  });
});
