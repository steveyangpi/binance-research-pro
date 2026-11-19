import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/cache/ttl-cache.js';

describe('TtlCache', () => {
  it('deduplicates concurrent in-flight loads for the same key', async () => {
    const cache = new TtlCache(10);
    let calls = 0;
    let resolveLoader!: (value: number) => void;
    const loader = () => {
      calls += 1;
      return new Promise<number>((resolve) => {
        resolveLoader = resolve;
      });
    };

    const first = cache.getOrLoad('k', 60_000, loader);
    const second = cache.getOrLoad('k', 60_000, loader);
    resolveLoader(42);

    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
    expect(calls).toBe(1);
  });

  it('evicts the oldest entries when maxEntries is exceeded', async () => {
    const cache = new TtlCache(2);
    let calls = 0;
    const load = (key: string) =>
      cache.getOrLoad(key, 60_000, async () => {
        calls += 1;
        return `${key}:${calls}`;
      });

    expect(await load('a')).toBe('a:1');
    expect(await load('b')).toBe('b:2');
    expect(await load('c')).toBe('c:3');

    // 'a' was evicted, while 'b' and 'c' remain cached.
    expect(await load('b')).toBe('b:2');
    expect(await load('c')).toBe('c:3');
    expect(await load('a')).toBe('a:4');
  });

  it('bypasses cache storage when ttlMs is zero', async () => {
    const cache = new TtlCache(10);
    let calls = 0;
    const first = await cache.getOrLoad('k', 0, async () => {
      calls += 1;
      return calls;
    });
    const second = await cache.getOrLoad('k', 0, async () => {
      calls += 1;
      return calls;
    });

    expect(first).toBe(1);
    expect(second).toBe(2);
  });
});
