import { homedir, platform } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const APP_DIRECTORY = 'BinanceResearchPro';

type PlatformName = NodeJS.Platform;

export type PlatformPathEnvironment = Partial<
  Record<'LOCALAPPDATA' | 'XDG_DATA_HOME' | 'HOME' | 'USERPROFILE', string | undefined>
>;

export function defaultDataDirectory(
  environment: PlatformPathEnvironment = process.env,
  platformName: PlatformName = platform(),
  homeDirectory: string = homedir(),
): string {
  if (platformName === 'win32') {
    const localAppData = environment.LOCALAPPDATA?.trim();
    if (localAppData) return resolve(localAppData, APP_DIRECTORY);
    const profile = environment.USERPROFILE?.trim() || homeDirectory;
    return resolve(profile, 'AppData', 'Local', APP_DIRECTORY);
  }

  if (platformName === 'darwin') {
    const home = environment.HOME?.trim() || homeDirectory;
    return resolve(home, 'Library', 'Application Support', APP_DIRECTORY);
  }

  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return resolve(xdgDataHome, 'binance-research-pro');
  const home = environment.HOME?.trim() || homeDirectory;
  return resolve(home, '.local', 'share', 'binance-research-pro');
}

export function resolveDataDirectory(
  configuredPath: string | undefined,
  environment: PlatformPathEnvironment = process.env,
  platformName: PlatformName = platform(),
  homeDirectory: string = homedir(),
): string {
  const candidate = configuredPath?.trim();
  return candidate
    ? resolve(candidate)
    : defaultDataDirectory(environment, platformName, homeDirectory);
}

export function derivedRuntimePaths(dataDirectory: string) {
  return {
    cacheDatabasePath: join(dataDirectory, 'cache', 'market-cache.sqlite'),
    warehouseParquetRoot: join(dataDirectory, 'warehouse', 'parquet'),
    warehouseMetadataDatabasePath: join(dataDirectory, 'warehouse', 'metadata.sqlite'),
    warehouseTempDirectory: join(dataDirectory, 'warehouse', 'tmp'),
    warehouseImportRoots: join(dataDirectory, 'imports'),
  };
}

export function parsePathList(value: string): string[] {
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}
