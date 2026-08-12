import type { CacheStore } from './cache-store.js';

type CacheEntry<T> = { value: T; expiresAt: number };

/** A deliberately small, in-process cache for public, time-sensitive market data. */
export class TtlCache implements CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  public async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return entry.value;
    }

    const value = await loader();
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }
}
