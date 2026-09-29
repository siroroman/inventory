import { describe, expect, it } from 'vitest';
import { initials } from '../src/features/auth/initials.ts';

describe('initials', () => {
  it('takes the first letters of the first and last name', () => {
    expect(initials('Anna Nováková', 'a@example.test')).toBe('AN');
    expect(initials('  jan   karel  černý ', 'j@example.test')).toBe('JČ');
  });

  it('handles a single name and an empty one', () => {
    expect(initials('Anna', 'a@example.test')).toBe('A');
    expect(initials('   ', 'zdenek@example.test')).toBe('Z');
  });
});
