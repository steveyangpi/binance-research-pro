import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccountProfileStore,
  AccountConfigurationError,
} from '../src/account/account-profile-store.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeProfiles(profiles: unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'binance-account-profiles-'));
  temporaryRoots.push(root);
  const path = join(root, 'profiles.json');
  await writeFile(path, JSON.stringify({ version: 1, profiles }), 'utf8');
  return path;
}

const spotProfile = {
  id: 'spot-read',
  keyType: 'ed25519',
  apiKey: 'test-api-key-that-is-not-real',
  privateKeyPath: './spot-private.pem',
  surfaces: ['spot'],
  permissions: ['USER_DATA'],
};

describe('AccountProfileStore', () => {
  it('reports an unconfigured state without reading credentials', async () => {
    await expect(new AccountProfileStore().status()).resolves.toEqual({
      configured: false,
      profiles: [],
    });
  });

  it('returns only non-secret profile metadata', async () => {
    const store = new AccountProfileStore(await writeProfiles([spotProfile]));
    const status = await store.status();

    expect(status).toEqual({
      configured: true,
      profiles: [
        {
          id: 'spot-read',
          keyType: 'ed25519',
          surfaces: ['spot'],
          permissions: ['USER_DATA'],
        },
      ],
    });
    expect(JSON.stringify(status)).not.toContain(spotProfile.apiKey);
    expect(JSON.stringify(status)).not.toContain('spot-private.pem');
  });

  it('requires an explicit profile when several keys cover the same surface', async () => {
    const second = { ...spotProfile, id: 'spot-read-two' };
    const store = new AccountProfileStore(await writeProfiles([spotProfile, second]));

    await expect(store.requireProfile(undefined, 'spot')).rejects.toThrow(
      'specify profileId explicitly',
    );
    await expect(store.requireProfile('spot-read-two', 'spot')).resolves.toMatchObject({
      id: 'spot-read-two',
    });
  });

  it('enforces each profile surface declaration', async () => {
    const store = new AccountProfileStore(await writeProfiles([spotProfile]));

    await expect(store.requireProfile('spot-read', 'usd-m-futures')).rejects.toBeInstanceOf(
      AccountConfigurationError,
    );
  });

  it('rejects profiles that omit the explicit USER_DATA permission', async () => {
    const missingPermissions: Record<string, unknown> = { ...spotProfile };
    delete missingPermissions.permissions;
    const store = new AccountProfileStore(await writeProfiles([missingPermissions]));

    await expect(store.status()).rejects.toThrow('Required');
  });

  it('rejects duplicate surfaces in a profile', async () => {
    const duplicateSurfaces = {
      ...spotProfile,
      surfaces: ['spot', 'spot'],
    };
    const store = new AccountProfileStore(await writeProfiles([duplicateSurfaces]));

    await expect(store.status()).rejects.toThrow('Account profile surfaces must be unique.');
  });
});
