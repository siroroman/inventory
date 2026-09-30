import { describe, expect, it } from 'vitest';
import { createLocationBody, locationListQuery, updateLocationBody } from '../src/index.ts';

const ID = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

describe('createLocationBody', () => {
  it('needs only a name; the rest is optional', () => {
    expect(createLocationBody.parse({ name: ' Praha ' })).toEqual({ name: 'Praha' });
    expect(createLocationBody.parse({ name: 'Praha', parentId: null, locationTypeId: ID, address: null, note: null })).toMatchObject({
      locationTypeId: ID,
    });
  });

  it('takes an optional ID, trimmed and upper-cased', () => {
    expect(createLocationBody.parse({ name: 'x', code: ' sklad-a.1 ' })).toEqual({ name: 'x', code: 'SKLAD-A.1' });
  });

  it('rejects a blank name, a bad id, empty text, too long text and unknown keys', () => {
    for (const body of [
      {},
      { name: '  ' },
      { name: 'x'.repeat(121) },
      { name: 'x', parentId: 'nope' },
      { name: 'x', address: '' },
      { name: 'x', address: 'a'.repeat(201) },
      { name: 'x', note: 'n'.repeat(2001) },
      { name: 'x', code: '' },
      { name: 'x', code: 'has space' },
      { name: 'x', code: 'X'.repeat(31) },
      { name: 'x', unknown: 1 },
    ]) {
      expect(createLocationBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('updateLocationBody', () => {
  it('needs the version and at least one field; null clears one', () => {
    expect(updateLocationBody.parse({ version: 2, address: null })).toEqual({ version: 2, address: null });
    expect(updateLocationBody.safeParse({ version: 2 }).success).toBe(false);
    expect(updateLocationBody.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateLocationBody.safeParse({ version: 0, name: 'x' }).success).toBe(false);
  });

  it('rejects unknown keys and a blank name', () => {
    expect(updateLocationBody.safeParse({ version: 1, code: 'LOC-999' }).success).toBe(false);
    expect(updateLocationBody.safeParse({ version: 1, name: ' ' }).success).toBe(false);
  });
});

describe('locationListQuery', () => {
  it('defaults the limit and ignores a blank search', () => {
    expect(locationListQuery.parse({})).toEqual({ limit: 50 });
    expect(locationListQuery.parse({ q: '  ' })).toEqual({ limit: 50, q: undefined });
    expect(locationListQuery.parse({ q: ' Kuchyně ', parentId: ID })).toMatchObject({ q: 'Kuchyně', parentId: ID });
  });

  it('rejects a bad parent id and limit', () => {
    expect(locationListQuery.safeParse({ parentId: 'nope' }).success).toBe(false);
    expect(locationListQuery.safeParse({ limit: '0' }).success).toBe(false);
  });
});
