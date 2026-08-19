import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountApiClient } from '../src/account/account-api-client.js';
import { AccountProfileStore } from '../src/account/account-profile-store.js';
import { loadConfig } from '../src/config.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'binance-account-client-'));
  temporaryRoots.push(root);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await writeFile(join(root, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const profilesPath = join(root, 'profiles.json');
  const apiKey = 'test-api-key-that-is-not-real';
  await writeFile(
    profilesPath,
    JSON.stringify({
      version: 1,
      profiles: [
        {
          id: 'readonly',
          keyType: 'ed25519',
          apiKey,
          privateKeyPath: './private.pem',
          surfaces: ['spot', 'usd-m-futures'],
          permissions: ['USER_DATA'],
        },
      ],
    }),
  );
  const config = loadConfig({
    BINANCE_ACCOUNT_PROFILES_PATH: profilesPath,
    BINANCE_PERSISTENT_CACHE_ENABLED: 'false',
  });
  return {
    apiKey,
    publicKey,
    client: new AccountApiClient(config, new AccountProfileStore(profilesPath)),
  };
}

describe('AccountApiClient', () => {
  it('signs the exact encoded query and sends the API key only in the header', async () => {
    const fixture = await createFixture();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ balances: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await fixture.client.get('spot', 'readonly', '/api/v3/account', { omitZeroBalances: 'true' });

    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const signature = input.searchParams.get('signature');
    expect(signature).not.toBeNull();
    input.searchParams.delete('signature');
    expect(
      verify(
        null,
        Buffer.from(input.searchParams.toString()),
        fixture.publicKey,
        Buffer.from(signature as string, 'base64'),
      ),
    ).toBe(true);
    expect((init.headers as Record<string, string>)['X-MBX-APIKEY']).toBe(fixture.apiKey);
    expect(input.toString()).not.toContain(fixture.apiKey);
  });

  it('synchronizes server time and retries once after error -1021', async () => {
    const fixture = await createFixture();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: -1021, msg: 'Timestamp outside recvWindow.' }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ serverTime: Date.now() + 2_000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balances: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fixture.client.get('spot', 'readonly', '/api/v3/account')).resolves.toMatchObject({
      profileId: 'readonly',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not expose API keys in Binance error messages', async () => {
    const fixture = await createFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: -2015, msg: 'Invalid API-key, IP, or permissions.' }), {
          status: 401,
        }),
      ),
    );

    let message = '';
    try {
      await fixture.client.get('spot', 'readonly', '/api/v3/account');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('-2015');
    expect(message).not.toContain(fixture.apiKey);
  });
});
