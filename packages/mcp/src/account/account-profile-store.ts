import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const accountSurfaceSchema = z.enum(['spot', 'usd-m-futures']);

const accountProfileSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/),
    keyType: z.literal('ed25519'),
    apiKey: z.string().trim().min(16).max(256),
    privateKeyPath: z.string().trim().min(1),
    privateKeyPassphrasePath: z.string().trim().min(1).optional(),
    surfaces: z
      .array(accountSurfaceSchema)
      .min(1)
      .max(2)
      .refine(
        (surfaces) => new Set(surfaces).size === surfaces.length,
        'Account profile surfaces must be unique.',
      ),
    permissions: z.array(z.literal('USER_DATA')).length(1),
  })
  .strict();

const accountProfilesFileSchema = z
  .object({
    version: z.literal(1),
    profiles: z
      .array(accountProfileSchema)
      .min(1)
      .max(20)
      .refine(
        (profiles) => new Set(profiles.map((profile) => profile.id)).size === profiles.length,
        'Account profile IDs must be unique.',
      ),
  })
  .strict();

export type AccountSurface = z.infer<typeof accountSurfaceSchema>;

export type AccountProfile = {
  id: string;
  keyType: 'ed25519';
  apiKey: string;
  privateKeyPath: string;
  privateKeyPassphrasePath?: string | undefined;
  surfaces: AccountSurface[];
  permissions: Array<'USER_DATA'>;
};

export type AccountProfileStatus = {
  id: string;
  keyType: 'ed25519';
  permissions: Array<'USER_DATA'>;
  surfaces: AccountSurface[];
};

export class AccountConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AccountConfigurationError';
  }
}

export class AccountProfileStore {
  private profilesPromise?: Promise<AccountProfile[]>;

  public constructor(private readonly profilesPath?: string) {}

  public async status(): Promise<{ configured: boolean; profiles: AccountProfileStatus[] }> {
    if (!this.profilesPath) return { configured: false, profiles: [] };
    const profiles = await this.loadProfiles();
    return {
      configured: true,
      profiles: profiles.map(({ id, keyType, permissions, surfaces }) => ({
        id,
        keyType,
        permissions,
        surfaces,
      })),
    };
  }

  public async requireProfile(
    requestedId: string | undefined,
    surface: AccountSurface,
  ): Promise<AccountProfile> {
    if (!this.profilesPath) {
      throw new AccountConfigurationError(
        'Private account research is not configured. Set BINANCE_ACCOUNT_PROFILES_PATH to a protected credentials file.',
      );
    }

    const profiles = await this.loadProfiles();
    if (requestedId) {
      const profile = profiles.find((candidate) => candidate.id === requestedId);
      if (!profile) throw new AccountConfigurationError(`Unknown account profile: ${requestedId}`);
      if (!profile.surfaces.includes(surface)) {
        throw new AccountConfigurationError(
          `Account profile ${requestedId} is not authorized for ${surface}.`,
        );
      }
      return profile;
    }

    const candidates = profiles.filter((profile) => profile.surfaces.includes(surface));
    if (candidates.length === 0) {
      throw new AccountConfigurationError(`No account profile is configured for ${surface}.`);
    }
    if (candidates.length > 1) {
      throw new AccountConfigurationError(
        `Multiple account profiles are configured for ${surface}; specify profileId explicitly.`,
      );
    }
    return candidates[0] as AccountProfile;
  }

  private loadProfiles(): Promise<AccountProfile[]> {
    this.profilesPromise ??= this.readProfiles();
    return this.profilesPromise;
  }

  private async readProfiles(): Promise<AccountProfile[]> {
    const profilesPath = resolve(this.profilesPath as string);
    let raw: string;
    try {
      raw = await readFile(profilesPath, 'utf8');
    } catch {
      throw new AccountConfigurationError('Unable to read the account credentials file.');
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AccountConfigurationError('The account credentials file is not valid JSON.');
    }

    const parsed = accountProfilesFileSchema.safeParse(value);
    if (!parsed.success) {
      throw new AccountConfigurationError(
        `Invalid account credentials configuration: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }

    const baseDirectory = dirname(profilesPath);
    return parsed.data.profiles.map((profile) => ({
      ...profile,
      privateKeyPath: resolve(baseDirectory, profile.privateKeyPath),
      ...(profile.privateKeyPassphrasePath
        ? { privateKeyPassphrasePath: resolve(baseDirectory, profile.privateKeyPassphrasePath) }
        : {}),
    }));
  }
}
