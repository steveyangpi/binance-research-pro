import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInside, validatePartitionValue } from '../src/warehouse/path-utils.js';

describe('warehouse path safety', () => {
  it('rejects traversal and SQL/path separators in partition values', () => {
    expect(() => validatePartitionValue('../BTCUSDT', 'symbol')).toThrow();
    expect(() => validatePartitionValue("BTC'USDT", 'symbol')).toThrow();
    expect(validatePartitionValue('BTCUSDT', 'symbol')).toBe('BTCUSDT');
  });

  it('does not confuse sibling paths with child paths', () => {
    const parent = resolve('data', 'lake');
    expect(isPathInside(join(parent, 'file.csv'), parent)).toBe(true);
    expect(isPathInside(resolve('data', 'lake-other', 'file.csv'), parent)).toBe(false);
  });
});
