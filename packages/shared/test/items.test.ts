import { describe, expect, it } from 'vitest';
import { createItemBody, itemSearchQuery, updateItemBody } from '../src/index.ts';

const ID = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';
const base = { name: 'Konvektomat', locationId: ID };

describe('createItemBody', () => {
  it('takes an optional ID, trimmed and upper-cased, and rejects unsafe ones', () => {
    expect(createItemBody.parse({ ...base, code: ' vaha-1.a ' })).toEqual({ ...base, code: 'VAHA-1.A' });
    for (const code of ['', 'has space', 'ČÁRKA', '-A', '/q', 'X'.repeat(31)]) {
      expect(createItemBody.safeParse({ ...base, code }).success, code).toBe(false);
    }
  });

  it('needs a name and a location; the rest is optional', () => {
    expect(createItemBody.parse({ name: ' Konvektomat ', locationId: ID })).toEqual(base);
    expect(
      createItemBody.parse({
        ...base,
        manufacturerId: ID,
        model: 'iCombi Pro',
        serialNumber: 'SN-1',
        manufactureYear: 2019,
        registeredOn: '2020-01-15',
        warrantyUntil: '2022-01-15',
        lastServiceOn: null,
        nextServiceOn: '2026-11-01',
        documentsUrl: 'https://drive.google.com/drive/folders/abc',
        note: null,
        externalIds: [{ source: ' Elektrikář ', value: 'EL-4821' }],
      }),
    ).toMatchObject({ externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }], lastServiceOn: null });
  });

  it('accepts the years 1950 to the current one', () => {
    const year = new Date().getFullYear();
    for (const manufactureYear of [1950, year]) {
      expect(createItemBody.safeParse({ ...base, manufactureYear }).success, String(manufactureYear)).toBe(true);
    }
    for (const manufactureYear of [1949, year + 1, 2019.5, '2019']) {
      expect(createItemBody.safeParse({ ...base, manufactureYear }).success, String(manufactureYear)).toBe(false);
    }
  });

  it('rejects missing or bad required fields, bad dates, bad links and unknown keys', () => {
    for (const body of [
      {},
      { name: 'x' },
      { locationId: ID },
      { ...base, name: '  ' },
      { ...base, name: 'x'.repeat(201) },
      { ...base, locationId: null },
      { ...base, locationId: 'nope' },
      { ...base, manufacturerId: 'nope' },
      { ...base, registeredOn: '15. 1. 2020' },
      { ...base, warrantyUntil: '2020-02-30' },
      { ...base, documentsUrl: 'https://evil.example/x' },
      { ...base, documentsUrl: 'https://drive.google.com' },
      { ...base, model: '' },
      { ...base, serialNumber: 's'.repeat(121) },
      { ...base, note: 'n'.repeat(2001) },
      { ...base, archivedAt: null },
    ]) {
      expect(createItemBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('checks external IDs: both parts, trimmed, at most 20, no extra keys', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ source: 'S', value: `V${i}` }));
    expect(createItemBody.safeParse({ ...base, externalIds: ids(20) }).success).toBe(true);
    expect(createItemBody.safeParse({ ...base, externalIds: [] }).success).toBe(true);
    for (const externalIds of [
      ids(21),
      [{ source: 'S' }],
      [{ value: 'V' }],
      [{ source: ' ', value: 'V' }],
      [{ source: 'S', value: '' }],
      [{ source: 'S'.repeat(61), value: 'V' }],
      [{ source: 'S', value: 'V'.repeat(121) }],
      [{ source: 'S', value: 'V', id: ID }],
    ]) {
      expect(createItemBody.safeParse({ ...base, externalIds }).success, JSON.stringify(externalIds)).toBe(false);
    }
  });
});

describe('updateItemBody', () => {
  it('needs the version and at least one field; null clears an optional one', () => {
    expect(updateItemBody.parse({ version: 2, manufacturerId: null, warrantyUntil: null })).toEqual({
      version: 2,
      manufacturerId: null,
      warrantyUntil: null,
    });
    expect(updateItemBody.parse({ version: 2, externalIds: [] })).toEqual({ version: 2, externalIds: [] });
    expect(updateItemBody.safeParse({ version: 2 }).success).toBe(false);
    expect(updateItemBody.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateItemBody.safeParse({ version: 0, name: 'x' }).success).toBe(false);
  });

  it('cannot clear the name or the location, and applies the create checks', () => {
    for (const body of [
      { version: 1, name: null },
      { version: 1, name: ' ' },
      { version: 1, locationId: null },
      { version: 1, manufactureYear: new Date().getFullYear() + 1 },
      { version: 1, documentsUrl: 'http://drive.google.com/x' },
      { version: 1, externalIds: [{ source: 'S' }] },
      { version: 1, code: 'INV-99999' },
    ]) {
      expect(updateItemBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('itemSearchQuery', () => {
  it('defaults the limit and takes optional filters', () => {
    expect(itemSearchQuery.parse({})).toEqual({ limit: 50 });
    expect(itemSearchQuery.parse({ q: ' EL-4821 ', locationId: ID, manufacturerId: ID })).toMatchObject({
      q: 'EL-4821',
      locationId: ID,
      manufacturerId: ID,
    });
  });

  it('rejects filters that are not ids', () => {
    expect(itemSearchQuery.safeParse({ locationId: 'nope' }).success).toBe(false);
    expect(itemSearchQuery.safeParse({ manufacturerId: 'nope' }).success).toBe(false);
  });
});
