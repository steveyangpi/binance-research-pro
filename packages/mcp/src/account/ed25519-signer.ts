import { createPrivateKey, sign as signPayload, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AccountProfile } from './account-profile-store.js';
import { AccountConfigurationError } from './account-profile-store.js';

export class Ed25519Signer {
  private constructor(private readonly privateKey: KeyObject) {}

  public static async fromProfile(profile: AccountProfile): Promise<Ed25519Signer> {
    let privateKeyPem: Buffer;
    let passphrase: string | undefined;
    try {
      privateKeyPem = await readFile(profile.privateKeyPath);
      if (profile.privateKeyPassphrasePath) {
        passphrase = (await readFile(profile.privateKeyPassphrasePath, 'utf8')).replace(
          /\r?\n$/,
          '',
        );
      }
    } catch {
      throw new AccountConfigurationError(
        `Unable to read the private signing material for account profile ${profile.id}.`,
      );
    }

    try {
      const privateKey = createPrivateKey({
        key: privateKeyPem,
        format: 'pem',
        ...(passphrase === undefined ? {} : { passphrase }),
      });
      if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('not an Ed25519 private key');
      }
      return new Ed25519Signer(privateKey);
    } catch {
      throw new AccountConfigurationError(
        `Invalid Ed25519 private key or passphrase for account profile ${profile.id}.`,
      );
    }
  }

  public sign(payload: string): string {
    return signPayload(null, Buffer.from(payload, 'utf8'), this.privateKey).toString('base64');
  }
}
