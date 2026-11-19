import type { CacheStore } from './cache-store.js';

type CacheEntry<T> = { value: T; expiresAt: number };

/** A deliberately small, in-process cache for public, time-sensitive market data. */
export class TtlCache implements CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  public constructor(private readonly maxEntries = 10_000) {}

  public async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    if (ttlMs > 0) {
      const entry = this.entries.get(key) as CacheEntry<T> | undefined;
      if (entry !== undefined) {
        if (entry.expiresAt > Date.now()) return entry.value;
        this.entries.delete(key);
      }
    }

    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending !== undefined) return pending;

    const loadPromise = loader().then((value) => {
      if (ttlMs > 0) this.write(key, value, ttlMs);
      return value;
    });
    this.inFlight.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private write<T>(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    // Delete first so re-inserting moves the key to the end of Map insertion order.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlMs });

    if (this.entries.size <= this.maxEntries) return;
    for (const [candidateKey, candidate] of this.entries) {
      if (candidate.expiresAt <= now) this.entries.delete(candidateKey);
    }
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
