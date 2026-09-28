import { describe, expect, it } from 'vitest';
import { type Actor, assertRole, hasRole, type Role } from '../../src/auth/roles.ts';
import { DomainError } from '../../src/errors.ts';

const actor = (role: Role): Actor => ({ id: 'u1', role });

describe('roles', () => {
  it.each([
    ['read', 'read', true],
    ['read', 'write', false],
    ['write', 'read', true],
    ['write', 'write', true],
    ['write', 'admin', false],
    ['admin', 'write', true],
    ['admin', 'admin', true],
  ] as const)('%s meets %s: %s', (role, minimum, expected) => {
    expect(hasRole(actor(role), minimum)).toBe(expected);
  });

  it('assertRole throws forbidden', () => {
    expect(() => assertRole(actor('read'), 'write')).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() => assertRole(actor('read'), 'write')).toThrow(DomainError);
    expect(() => assertRole(actor('admin'), 'write')).not.toThrow();
  });
});
