import { describe, expect, it } from 'vitest';
import { isPathInside, validatePartitionValue } from '../src/warehouse/path-utils.js';

describe('warehouse path safety', () => {
  it('rejects traversal and SQL/path separators in partition values', () => {
    expect(() => validatePartitionValue('../BTCUSDT', 'symbol')).toThrow();
    expect(() => validatePartitionValue("BTC'USDT", 'symbol')).toThrow();
    expect(validatePartitionValue('BTCUSDT', 'symbol')).toBe('BTCUSDT');
  });

  it('does not confuse sibling paths with child paths', () => {
    expect(isPathInside('C:\\data\\lake\\file.csv', 'C:\\data\\lake')).toBe(true);
    expect(isPathInside('C:\\data\\lake-other\\file.csv', 'C:\\data\\lake')).toBe(false);
  });
});
