import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const smokeTest = await readFile(resolve(root, 'packages/mcp/scripts/mcp-smoke-test.mjs'), 'utf8');
const toolList = /const expectedTools = \[(?<tools>[\s\S]*?)\];/.exec(smokeTest)?.groups?.tools;
if (!toolList) throw new Error('Unable to read the canonical MCP tool list from the smoke test.');

const availableTools = new Set(
  [...toolList.matchAll(/'(?<name>[a-z][a-z0-9_]*)'/g)].map((match) => match.groups.name),
);
// Skills also backtick non-tool identifiers (indicator status values, warehouse
// column names, enum members). Only treat a token as a tool reference when it
// starts with a segment used by a real tool, then still require an exact match
// so a misspelled tool name keeps failing.
const toolPrefixes = new Set([...availableTools].map((name) => name.split('_')[0]));
const skillDirectory = resolve(root, 'skills');
const skillNames = await readdir(skillDirectory);
const missing = [];

for (const skillName of skillNames) {
  const skillPath = resolve(skillDirectory, skillName, 'SKILL.md');
  let content;
  try {
    content = await readFile(skillPath, 'utf8');
  } catch {
    continue;
  }
  for (const match of content.matchAll(/`(?<tool>[a-z][a-z0-9_]+)`/g)) {
    const { tool } = match.groups;
    const looksLikeTool = tool.includes('_') && toolPrefixes.has(tool.split('_')[0]);
    if (looksLikeTool && !availableTools.has(tool)) missing.push(`${skillName}: ${tool}`);
  }
}

if (missing.length > 0) {
  throw new Error(`Skills reference unknown MCP tools:\n${missing.join('\n')}`);
}

console.log(`Skill tool references passed for ${skillNames.length} skills.`);
