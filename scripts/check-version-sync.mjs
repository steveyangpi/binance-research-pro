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

function parsePinnedPackage(server, packageName, client) {
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
    fail(`${client} MCP config must use the portable fixed ${packageName} npx launcher.`);
  }

  const pinnedVersion = packageArgument.slice(expectedPrefix.length);
  if (!PRODUCT_VERSION.test(pinnedVersion)) {
    fail(`${client} MCP version is not an exact published SemVer version: ${pinnedVersion}`);
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

const [
  rootPackage,
  lockfile,
  mcpPackage,
  codexMcpConfig,
  claudeMcpConfig,
  codexManifest,
  claudeManifest,
] = await Promise.all([
  readJson('package.json'),
  readJson('package-lock.json'),
  readJson('packages/mcp/package.json'),
  readJson('.mcp.json'),
  readJson('claude.mcp.json'),
  readJson('.codex-plugin/plugin.json'),
  readJson('.claude-plugin/plugin.json'),
]);

const codexServer = codexMcpConfig.mcpServers?.['binance-research-pro'];
const claudeServer = claudeMcpConfig.mcpServers?.['binance-research-pro'];
const codexPin = parsePinnedPackage(codexServer, mcpPackage.name, 'Codex');
const claudePin = parsePinnedPackage(claudeServer, mcpPackage.name, 'Claude');

if (
  codexManifest.name !== 'binance-research-pro' ||
  claudeManifest.name !== 'binance-research-pro'
) {
  fail('Both plugin manifests must remain named binance-research-pro.');
}
if (codexManifest.mcpServers !== './.mcp.json') {
  fail('Codex manifest must reference ./.mcp.json.');
}
if (claudeManifest.mcpServers !== './claude.mcp.json') {
  fail('Claude manifest must reference ./claude.mcp.json.');
}
if (claudeManifest.skills !== './skills/') {
  fail('Claude manifest must reference ./skills/.');
}
if (mcpPackage.repository?.url !== 'git+https://github.com/steveyangpi/binance-research-pro.git') {
  fail('MCP package repository URL does not match the monorepo.');
}
if (mcpPackage.repository?.directory !== 'packages/mcp') {
  fail('MCP package repository.directory must be packages/mcp.');
}

const codexVersion = CODEX_PLUGIN_VERSION.exec(codexManifest.version ?? '');
if (!codexVersion) {
  fail('Codex plugin version must use X.Y.Z+codex.YYYYMMDDHHmmss UTC deployment metadata.');
}
if (!PRODUCT_VERSION.test(claudeManifest.version ?? '')) {
  fail('Claude plugin version must use exact product SemVer.');
}
if (codexPin.pinnedVersion !== claudePin.pinnedVersion) {
  fail('Codex and Claude plugins must pin the same MCP package version.');
}
if (codexVersion.groups.core !== codexPin.pinnedVersion) {
  fail('Codex plugin version core must match its MCP package pin.');
}
if (claudeManifest.version !== claudePin.pinnedVersion) {
  fail('Claude plugin version must match its MCP package pin.');
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
  if (codexPin.pinnedVersion !== productVersion || claudePin.pinnedVersion !== productVersion) {
    fail(
      `Plugins pin ${codexPin.pinnedVersion}, but MCP source is ${productVersion}. Publish and verify the MCP package before updating both plugin pins.`,
    );
  }
  if (codexVersion.groups.core !== productVersion || claudeManifest.version !== productVersion) {
    fail('Both plugin manifest versions must match the product version.');
  }

  const pinPattern = new RegExp(
    `${mcpPackage.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`,
    'g',
  );
  for (const document of DOCUMENTS_WITH_CURRENT_PIN) {
    const content = await readText(document);
    const versions = [...content.matchAll(pinPattern)].map((match) => match.groups.version);
    if (versions.length === 0) fail(`${document} must contain the current exact MCP package pin.`);
    if (versions.some((version) => version !== codexPin.pinnedVersion)) {
      fail(`${document} contains an MCP pin that does not match ${codexPin.packageArgument}.`);
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
  `Release state passed: source ${mcpPackage.version}, plugin pins ${codexPin.pinnedVersion}, Codex ${codexManifest.version}, Claude ${claudeManifest.version}.`,
);
