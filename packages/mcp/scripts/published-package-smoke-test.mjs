import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import packageMetadata from '../package.json' with { type: 'json' };

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const publishedVersion = process.env.MCP_PUBLISHED_VERSION;
if (!publishedVersion || !exactVersion.test(publishedVersion)) {
  throw new Error('MCP_PUBLISHED_VERSION must be an exact SemVer package version.');
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'binance-research-pro-published-'));
const consumerDirectory = join(temporaryRoot, 'consumer');
const runtimeDataDirectory = join(temporaryRoot, 'runtime-data');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bundledNpmCliPath = join(
  dirname(process.execPath),
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);
const npmCliPath =
  process.env.npm_execpath ?? (existsSync(bundledNpmCliPath) ? bundledNpmCliPath : undefined);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(' ')}`, result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result.stdout;
}

function runNpm(args, options = {}) {
  if (npmCliPath) return run(process.execPath, [npmCliPath, ...args], options);
  if (process.platform === 'win32') {
    throw new Error('Unable to locate npm-cli.js for a shell-free published-package smoke test.');
  }
  return run(npmCommand, args, options);
}

try {
  mkdirSync(consumerDirectory, { recursive: true });
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'binance-research-pro-published-smoke', private: true }, null, 2),
  );

  const packageSpec = `${packageMetadata.name}@${publishedVersion}`;
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', packageSpec], {
    cwd: consumerDirectory,
    env: {
      ...process.env,
      npm_config_cache: join(temporaryRoot, 'npm-cache'),
    },
  });

  const installedPackageRoot = join(
    consumerDirectory,
    'node_modules',
    ...packageMetadata.name.split('/'),
  );
  const installedMetadata = JSON.parse(
    readFileSync(join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  if (installedMetadata.version !== publishedVersion) {
    throw new Error(
      `Installed package version ${installedMetadata.version} does not match ${publishedVersion}.`,
    );
  }

  const installedEntry = join(installedPackageRoot, 'dist', 'index.js');
  const installedCli = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'binance-research-pro-mcp.cmd' : 'binance-research-pro-mcp',
  );
  for (const requiredPath of [installedEntry, installedCli]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Published package is missing ${requiredPath}`);
    }
  }

  const smokeEnvironment = {
    ...process.env,
    MCP_TEST_COMMAND: process.platform === 'win32' ? process.execPath : installedCli,
    MCP_TEST_ARGS_JSON: JSON.stringify(process.platform === 'win32' ? [installedEntry] : []),
    BINANCE_RESEARCH_DATA_DIR: runtimeDataDirectory,
  };
  for (const name of [
    'BINANCE_ACCOUNT_PROFILES_PATH',
    'NODE_AUTH_TOKEN',
    'NPM_TOKEN',
    'GITHUB_TOKEN',
    'NPM_CONFIG_USERCONFIG',
    'npm_config_userconfig',
  ]) {
    delete smokeEnvironment[name];
  }
  run(process.execPath, [join(projectRoot, 'scripts', 'mcp-smoke-test.mjs')], {
    cwd: consumerDirectory,
    env: smokeEnvironment,
  });

  const expectedMetadataPath = join(runtimeDataDirectory, 'warehouse', 'metadata.sqlite');
  if (!existsSync(expectedMetadataPath)) {
    throw new Error(
      `Published MCP did not create its metadata database at ${expectedMetadataPath}`,
    );
  }
  console.log(`Published package smoke test passed: ${packageSpec}`);
} finally {
  const resolvedTemporaryRoot = dirname(join(temporaryRoot, 'safety-check'));
  if (resolvedTemporaryRoot === temporaryRoot && temporaryRoot.startsWith(tmpdir())) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
