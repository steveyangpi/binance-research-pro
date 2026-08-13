import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const PRODUCT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CODEX_PLUGIN_VERSION = /^(?<core>\d+\.\d+\.\d+)\+codex\.(?<revision>\d{14})$/;
const DOCUMENTS_WITH_CURRENT_PIN = [
  'docs/INSTALLATION.md',
  'docs/INSTALLATION.zh-CN.md',
  'docs/PORTABLE-MCP.md',
  'docs/PORTABLE-MCP.zh-CN.md',
  'packages/mcp/README.md',
  'packages/mcp/README.zh-CN.md',
  'packages/mcp/docs/CONNECTING.md',
  'packages/mcp/docs/CONNECTING.zh-CN.md',
  'packages/mcp/docs/ENVIRONMENT.md',
  'packages/mcp/docs/ENVIRONMENT.zh-CN.md',
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

async function readText(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function parsePinnedPackage(server, packageName) {
  const expectedArgs = ['-y', undefined, '--', 'binance-research-pro-mcp'];
  const packageArgument = server?.args?.[1];
  const expectedPrefix = `--package=${packageName}@`;
  expectedArgs[1] = packageArgument;

  if (
    server?.command !== 'npx' ||
    !Array.isArray(server.args) ||
    server.args.length !== 4 ||
    server.args.some((argument, index) => argument !== expectedArgs[index]) ||
    !packageArgument?.startsWith(expectedPrefix)
  ) {
    fail(`Plugin MCP config must use the portable fixed ${packageName} npx launcher.`);
  }

  const pinnedVersion = packageArgument.slice(expectedPrefix.length);
  if (!PRODUCT_VERSION.test(pinnedVersion)) {
    fail(`Plugin MCP version is not an exact published SemVer version: ${pinnedVersion}`);
  }
  return { packageArgument, pinnedVersion };
}

function readFinalTag() {
  const suppliedTag = process.env.GITHUB_REF_NAME ?? process.env.RELEASE_TAG;
  if (suppliedTag) return suppliedTag;
  return execFileSync('git', ['describe', '--exact-match', '--tags', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function assertAnnotatedTag(tag) {
  const type = execFileSync('git', ['cat-file', '-t', tag], { encoding: 'utf8' }).trim();
  if (type !== 'tag') fail(`Release tag ${tag} must be annotated, not a lightweight tag.`);
}

const requireCurrent = process.argv.includes('--require-current');
const requireFinalTag = process.argv.includes('--require-final-tag');
if (requireFinalTag && !requireCurrent) {
  fail('--require-final-tag requires --require-current.');
}

const [rootPackage, lockfile, mcpPackage, mcpConfig, pluginManifest] = await Promise.all([
  readJson('package.json'),
  readJson('package-lock.json'),
  readJson('packages/mcp/package.json'),
  readJson('.mcp.json'),
  readJson('.codex-plugin/plugin.json'),
]);

const server = mcpConfig.mcpServers?.['binance-research-pro'];
const { packageArgument, pinnedVersion } = parsePinnedPackage(server, mcpPackage.name);

if (pluginManifest.name !== 'binance-research-pro') {
  fail('Plugin manifest name must remain binance-research-pro.');
}
if (mcpPackage.repository?.url !== 'git+https://github.com/steveyangpi/binance-research-pro.git') {
  fail('MCP package repository URL does not match the monorepo.');
}
if (mcpPackage.repository?.directory !== 'packages/mcp') {
  fail('MCP package repository.directory must be packages/mcp.');
}

const pluginVersion = CODEX_PLUGIN_VERSION.exec(pluginManifest.version ?? '');
if (!pluginVersion) {
  fail('Plugin version must use X.Y.Z+codex.YYYYMMDDHHmmss UTC deployment metadata.');
}

if (requireCurrent) {
  const productVersion = mcpPackage.version;
  if (!PRODUCT_VERSION.test(productVersion)) {
    fail(`MCP source version is not SemVer: ${productVersion}`);
  }
  if (rootPackage.version !== productVersion) {
    fail(`Root workspace version ${rootPackage.version} must equal MCP version ${productVersion}.`);
  }
  if (
    lockfile.version !== rootPackage.version ||
    lockfile.packages?.['']?.version !== rootPackage.version
  ) {
    fail('Root package-lock.json metadata must match root package.json. Regenerate it with npm.');
  }
  if (lockfile.packages?.['packages/mcp']?.version !== productVersion) {
    fail(
      'The packages/mcp lockfile entry must match packages/mcp/package.json. Regenerate it with npm.',
    );
  }
  if (pluginVersion.groups.core !== productVersion) {
    fail(
      `Plugin version core ${pluginVersion.groups.core} must equal product version ${productVersion}.`,
    );
  }
  if (pinnedVersion !== productVersion) {
    fail(
      `Plugin pins ${pinnedVersion}, but MCP source is ${productVersion}. Publish and verify the MCP package before updating the plugin pin.`,
    );
  }

  const pinPattern = new RegExp(
    `${mcpPackage.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`,
    'g',
  );
  for (const document of DOCUMENTS_WITH_CURRENT_PIN) {
    const content = await readText(document);
    const versions = [...content.matchAll(pinPattern)].map((match) => match.groups.version);
    if (versions.length === 0) fail(`${document} must contain the current exact MCP package pin.`);
    if (versions.some((version) => version !== pinnedVersion)) {
      fail(`${document} contains an MCP pin that does not match ${packageArgument}.`);
    }
  }
}

if (requireFinalTag) {
  const expectedTag = `v${mcpPackage.version}`;
  const tag = readFinalTag();
  if (tag !== expectedTag) fail(`Expected final release tag ${expectedTag}, received ${tag}.`);
  assertAnnotatedTag(tag);
}

console.log(
  `Release state passed: source ${mcpPackage.version}, plugin pin ${pinnedVersion}, plugin ${pluginManifest.version}.`,
);
