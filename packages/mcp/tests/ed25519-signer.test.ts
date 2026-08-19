import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountProfile } from '../src/account/account-profile-store.js';
import { Ed25519Signer } from '../src/account/ed25519-signer.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('Ed25519Signer', () => {
  it('creates Binance-compatible base64 Ed25519 signatures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binance-ed25519-'));
    temporaryRoots.push(root);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPath = join(root, 'private.pem');
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const profile: AccountProfile = {
      id: 'readonly',
      keyType: 'ed25519',
      apiKey: 'test-api-key-that-is-not-real',
      privateKeyPath,
      surfaces: ['spot'],
      permissions: ['USER_DATA'],
    };
    const payload = 'recvWindow=5000&timestamp=1700000000000';

    const signature = (await Ed25519Signer.fromProfile(profile)).sign(payload);

    expect(verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'))).toBe(
      true,
    );
  });
});
