import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function verifySha256(actual: string, expected?: string): void {
  if (expected === undefined) return;
  const normalized = expected.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('expectedSha256 must contain exactly 64 hexadecimal characters.');
  }
  if (actual !== normalized) {
    throw new Error(`SHA-256 mismatch: expected ${normalized}, received ${actual}.`);
  }
}
