import JSONbig from 'json-bigint';
import type { AppConfig } from '../config.js';
import {
  AccountConfigurationError,
  type AccountProfile,
  type AccountProfileStore,
  type AccountSurface,
} from './account-profile-store.js';
import { Ed25519Signer } from './ed25519-signer.js';

const losslessJson = JSONbig({ storeAsString: true });

const trustedAccountOrigins: Record<AccountSurface, ReadonlySet<string>> = {
  spot: new Set([
    'https://api.binance.com',
    'https://api-gcp.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://api4.binance.com',
    'https://testnet.binance.vision',
  ]),
  'usd-m-futures': new Set(['https://fapi.binance.com', 'https://demo-fapi.binance.com']),
};

type QueryValue = string | number | undefined;

type BinanceErrorPayload = {
  code?: unknown;
  msg?: unknown;
};

export class BinanceAccountApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'BinanceAccountApiError';
  }
}

export class AccountApiClient {
  private readonly signers = new Map<string, Promise<Ed25519Signer>>();
  private readonly timeOffsets = new Map<AccountSurface, number>();

  public constructor(
    private readonly config: AppConfig,
    private readonly profiles: AccountProfileStore,
  ) {}

  public async get<T>(
    surface: AccountSurface,
    profileId: string | undefined,
    path: string,
    query: Record<string, QueryValue> = {},
  ): Promise<{ profileId: string; data: T }> {
    const profile = await this.profiles.requireProfile(profileId, surface);
    const data = await this.signedGet<T>(surface, profile, path, query, true);
    return { profileId: profile.id, data };
  }

  private async signedGet<T>(
    surface: AccountSurface,
    profile: AccountProfile,
    path: string,
    query: Record<string, QueryValue>,
    allowTimeRetry: boolean,
  ): Promise<T> {
    const baseUrl = this.baseUrl(surface);
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) params.set(name, String(value));
    }
    params.set('recvWindow', String(this.config.BINANCE_ACCOUNT_RECV_WINDOW_MS));
    params.set('timestamp', String(Math.round(Date.now() + (this.timeOffsets.get(surface) ?? 0))));

    const signer = await this.signer(profile);
    const signature = signer.sign(params.toString());
    const url = new URL(path, baseUrl);
    url.search = params.toString();
    url.searchParams.set('signature', signature);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.BINANCE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'X-MBX-APIKEY': profile.apiKey },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await this.toApiError(response, surface);
        if (allowTimeRetry && error.code === -1021) {
          await this.syncTime(surface);
          return this.signedGet<T>(surface, profile, path, query, false);
        }
        throw error;
      }
      const body = await response.text();
      try {
        return losslessJson.parse(body) as T;
      } catch {
        throw new BinanceAccountApiError(
          `Binance ${surface} account API returned an invalid JSON response.`,
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof BinanceAccountApiError) throw error;
      throw new BinanceAccountApiError(`Unable to reach the Binance ${surface} account API.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private signer(profile: AccountProfile): Promise<Ed25519Signer> {
    let signer = this.signers.get(profile.id);
    if (!signer) {
      signer = Ed25519Signer.fromProfile(profile);
      this.signers.set(profile.id, signer);
    }
    return signer;
  }

  private async syncTime(surface: AccountSurface): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.BINANCE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(new URL(this.timePath(surface), this.baseUrl(surface)), {
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('time request failed');
      const payload = (await response.json()) as { serverTime?: unknown };
      const serverTime = Number(payload.serverTime);
      if (!Number.isFinite(serverTime)) throw new Error('invalid server time');
      this.timeOffsets.set(surface, serverTime - Math.round((startedAt + Date.now()) / 2));
    } catch {
      throw new BinanceAccountApiError(`Unable to synchronize Binance ${surface} server time.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(surface: AccountSurface): string {
    const configured =
      surface === 'spot'
        ? this.config.BINANCE_REST_BASE_URL
        : this.config.BINANCE_FUTURES_REST_BASE_URL;
    const endpoint = new URL(configured);
    if (
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      !trustedAccountOrigins[surface].has(endpoint.origin)
    ) {
      throw new AccountConfigurationError(
        `Private account requests for ${surface} require a trusted Binance API origin.`,
      );
    }
    return endpoint.origin;
  }

  private timePath(surface: AccountSurface): string {
    return surface === 'spot' ? '/api/v3/time' : '/fapi/v1/time';
  }

  private async toApiError(
    response: Response,
    surface: AccountSurface,
  ): Promise<BinanceAccountApiError> {
    const body = (await response.text()).slice(0, 2_000);
    let payload: BinanceErrorPayload = {};
    try {
      payload = JSON.parse(body) as BinanceErrorPayload;
    } catch {
      // Fall through to a bounded generic message.
    }
    const code = typeof payload.code === 'number' ? payload.code : undefined;
    const detail = typeof payload.msg === 'string' ? payload.msg.slice(0, 300) : 'Unknown error';
    return new BinanceAccountApiError(
      `Binance ${surface} account API returned HTTP ${response.status}${code === undefined ? '' : ` (${code})`}: ${detail}`,
      response.status,
      code,
    );
  }
}
