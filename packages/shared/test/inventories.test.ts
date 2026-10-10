import { describe, expect, it } from 'vitest';
import {
  inventoryListQuery,
  inventoryPreviewQuery,
  scanInventoryBody,
  scanResultSchema,
  startInventoryBody,
} from '../src/index.ts';

const ID = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

describe('inventoryListQuery', () => {
  it('shows the runs in progress unless told otherwise', () => {
    expect(inventoryListQuery.parse({})).toMatchObject({ state: 'open', limit: 50 });
    expect(inventoryListQuery.parse({ state: 'closed', q: ' praha ', limit: '20' })).toMatchObject({
      state: 'closed',
      q: 'praha',
      limit: 20,
    });
  });

  it('rejects another state and an empty search is no search', () => {
    expect(inventoryListQuery.safeParse({ state: 'all' }).success).toBe(false);
    expect(inventoryListQuery.parse({ q: '  ' }).q).toBeUndefined();
  });

  it('lists the archived runs only when asked, with archived=true', () => {
    expect(inventoryListQuery.parse({}).archived).toBeUndefined();
    expect(inventoryListQuery.parse({ state: 'closed', archived: 'true' })).toMatchObject({ archived: 'true' });
    expect(inventoryListQuery.safeParse({ archived: 'false' }).success).toBe(false);
  });
});

describe('inventoryPreviewQuery and startInventoryBody', () => {
  it('need the id of a location', () => {
    expect(inventoryPreviewQuery.parse({ locationId: ID })).toEqual({ locationId: ID });
    expect(startInventoryBody.parse({ locationId: ID })).toEqual({ locationId: ID });
    for (const bad of [{}, { locationId: 'LOC-001' }, { locationId: '' }]) {
      expect(inventoryPreviewQuery.safeParse(bad).success).toBe(false);
      expect(startInventoryBody.safeParse(bad).success).toBe(false);
    }
  });

  it('refuses unknown keys in the start body', () => {
    expect(startInventoryBody.safeParse({ locationId: ID, status: 'finished' }).success).toBe(false);
  });
});

describe('scanInventoryBody', () => {
  it('upper-cases the code like an ID and counts a scan unless told otherwise', () => {
    expect(scanInventoryBody.parse({ code: ' inv-73-2023016 ' })).toEqual({ code: 'INV-73-2023016', method: 'scan' });
    expect(scanInventoryBody.parse({ code: 'INV-00042', locationId: ID, method: 'manual' })).toEqual({
      code: 'INV-00042',
      locationId: ID,
      method: 'manual',
    });
  });

  it('refuses text that is not an ID, a bad location, another method and unknown keys', () => {
    for (const bad of [
      {},
      { code: '' },
      { code: 'https://example.com/q/INV-1' },
      { code: 'INV 1' },
      { code: 'A'.repeat(31) },
      { code: 'INV-1', locationId: 'LOC-001' },
      { code: 'INV-1', method: 'import' },
      { code: 'INV-1', itemId: ID },
    ]) {
      expect(scanInventoryBody.safeParse(bad).success).toBe(false);
    }
  });
});

describe('scanResultSchema', () => {
  const item = { id: ID, code: 'INV-00042', name: 'Kávovar', path: [] };
  const row = {
    id: ID,
    code: 'INV-00042',
    name: 'Kávovar',
    kind: 'expected',
    locationId: ID,
    checkedAt: null,
    checkedBy: null,
    method: null,
    registeredPath: [],
    registeredElsewhere: false,
    moved: false,
  };

  it('accepts every outcome with its own fields', () => {
    for (const result of [
      { outcome: 'found', item, row, misplaced: false, wasMissing: false },
      { outcome: 'found_elsewhere', item, row, wasMissing: false },
      { outcome: 'already_checked', item, row },
      { outcome: 'archived', item },
      { outcome: 'unknown_code' },
    ]) {
      expect(scanResultSchema.safeParse(result).success).toBe(true);
    }
  });

  it('refuses a row that does not say whether its item is still registered elsewhere', () => {
    const { registeredElsewhere: _, ...incomplete } = row;
    expect(scanResultSchema.safeParse({ outcome: 'already_checked', item, row: incomplete }).success).toBe(false);
  });

  it('refuses an outcome without what it needs and an unknown outcome', () => {
    expect(scanResultSchema.safeParse({ outcome: 'found', item, row }).success).toBe(false);
    expect(scanResultSchema.safeParse({ outcome: 'archived' }).success).toBe(false);
    expect(scanResultSchema.safeParse({ outcome: 'moved', item }).success).toBe(false);
  });
});
