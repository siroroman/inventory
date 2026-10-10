import { describe, expect, it } from 'vitest';
import { inventoryListQuery, inventoryPreviewQuery, startInventoryBody } from '../src/index.ts';

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
