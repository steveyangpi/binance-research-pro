import { readFile } from 'node:fs/promises';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const [mcpPackage, mcpConfig, pluginManifest] = await Promise.all([
  readJson('packages/mcp/package.json'),
  readJson('.mcp.json'),
  readJson('.codex-plugin/plugin.json'),
]);

const server = mcpConfig.mcpServers?.['binance-research-pro'];
const packageArgument = server?.args?.find((argument) => argument.startsWith('--package='));
const expectedPrefix = `--package=${mcpPackage.name}@`;

if (server?.command !== 'npx' || !packageArgument?.startsWith(expectedPrefix)) {
  throw new Error(`Plugin MCP config must launch a pinned ${mcpPackage.name} version.`);
}
const pinnedVersion = packageArgument.slice(expectedPrefix.length);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pinnedVersion)) {
  throw new Error(`Plugin MCP version is not fixed: ${pinnedVersion}`);
}
if (process.argv.includes('--require-current') && pinnedVersion !== mcpPackage.version) {
  throw new Error(
    `Plugin pins ${pinnedVersion}, but MCP source is ${mcpPackage.version}. Publish the MCP package before updating the plugin pin.`,
  );
}
if (pluginManifest.name !== 'binance-research-pro') {
  throw new Error('Plugin manifest name must remain binance-research-pro.');
}
if (mcpPackage.repository?.url !== 'git+https://github.com/steveyangpi/binance-research-pro.git') {
  throw new Error('MCP package repository URL does not match the monorepo.');
}
if (mcpPackage.repository?.directory !== 'packages/mcp') {
  throw new Error('MCP package repository.directory must be packages/mcp.');
}

console.log(`Release state passed: source ${mcpPackage.version}, plugin pin ${pinnedVersion}.`);
