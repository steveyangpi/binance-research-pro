import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import packageMetadata from '../package.json' with { type: 'json' };

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'binance-research-pro-package-'));
const packageDirectory = join(temporaryRoot, 'package');
const consumerDirectory = join(temporaryRoot, 'consumer');
const cacheDirectory = join(temporaryRoot, 'npm-cache');
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
    throw new Error('Unable to locate npm-cli.js for a shell-free package smoke test.');
  }
  return run(npmCommand, args, options);
}

try {
  mkdirSync(packageDirectory, { recursive: true });
  mkdirSync(consumerDirectory, { recursive: true });
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'binance-research-pro-package-smoke', private: true }, null, 2),
  );

  const packOutput = runNpm(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', packageDirectory],
    { cwd: projectRoot },
  );
  const packed = JSON.parse(packOutput);
  const tarballPath = join(packageDirectory, packed[0].filename);
  if (!existsSync(tarballPath)) throw new Error(`npm pack did not create ${tarballPath}`);
  if (!packed[0].files?.some((file) => file.path === 'npm-shrinkwrap.json')) {
    throw new Error('Packed package is missing npm-shrinkwrap.json.');
  }

  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], {
    cwd: consumerDirectory,
    env: { ...process.env, npm_config_cache: cacheDirectory },
  });
  const installedEntry = join(
    consumerDirectory,
    'node_modules',
    ...packageMetadata.name.split('/'),
    'dist',
    'index.js',
  );
  const installedCli = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'binance-research-pro-mcp.cmd' : 'binance-research-pro-mcp',
  );
  for (const requiredPath of [installedEntry, installedCli]) {
    if (!existsSync(requiredPath)) throw new Error(`Packed package is missing ${requiredPath}`);
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
      `Installed MCP did not create its metadata database at ${expectedMetadataPath}`,
    );
  }
  console.log(`Package smoke test passed: ${packed[0].filename}`);
} finally {
  const resolvedTemporaryRoot = dirname(join(temporaryRoot, 'safety-check'));
  if (resolvedTemporaryRoot === temporaryRoot && temporaryRoot.startsWith(tmpdir())) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
