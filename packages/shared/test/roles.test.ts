import { describe, expect, it } from 'vitest';
import { roleAtLeast, roles } from '../src/index.ts';

describe('roleAtLeast', () => {
  it.each([
    ['read', 'read', true],
    ['read', 'write', false],
    ['read', 'admin', false],
    ['write', 'read', true],
    ['write', 'write', true],
    ['write', 'admin', false],
    ['admin', 'read', true],
    ['admin', 'write', true],
    ['admin', 'admin', true],
  ] as const)('%s meets %s: %s', (role, minimum, expected) => {
    expect(roleAtLeast(role, minimum)).toBe(expected);
  });

  it('orders roles from least to most privileged', () => {
    for (const [i, role] of roles.entries()) {
      for (const [j, minimum] of roles.entries()) expect(roleAtLeast(role, minimum)).toBe(i >= j);
    }
  });
});
