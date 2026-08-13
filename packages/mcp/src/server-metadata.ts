import { readFileSync } from 'node:fs';

type PackageMetadata = {
  name: string;
  version: string;
};

const metadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageMetadata;

export const serverMetadata = {
  name: metadata.name.replace(/^@[^/]+\//, ''),
  version: metadata.version,
};
