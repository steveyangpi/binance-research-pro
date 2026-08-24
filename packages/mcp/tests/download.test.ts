import { describe, expect, it } from 'vitest';
import { isDisallowedAddress } from '../src/warehouse/download.js';

describe('warehouse download address policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.2.10',
    '198.18.0.1',
    '198.51.100.10',
    '203.0.113.10',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:c0a8:101',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
  ])('rejects non-public address %s', (address) => {
    expect(isDisallowedAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '198.51.99.10', '203.0.112.10', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isDisallowedAddress(address)).toBe(false);
    },
  );
});
