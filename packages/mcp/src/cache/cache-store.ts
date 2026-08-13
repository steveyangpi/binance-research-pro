export interface CacheStore {
  getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
}
