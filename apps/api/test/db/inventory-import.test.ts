import { asc, count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ImportRefusedError, importInventory } from '../../src/db/import/inventory.ts';
import { itemExternalIds, items, locations, locationTypes, manufacturers, user } from '../../src/db/schema/index.ts';
import { createItemRepository } from '../../src/modules/items/repository.ts';
import { useTestDb } from '../helpers/db.ts';

// Made-up rows in the shape of the real files, which hold company data and stay out of git.
const csv = (header: readonly string[], rows: Record<string, string>[]) =>
  [header.join(','), ...rows.map((row) => header.map((c) => `"${(row[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

const LOCATION_HEADER = ['id', 'name', 'type', 'address', 'note', 'address_source', 'address_check'];
const ITEM_HEADER = [
  'location_id', 'name', 'manufacturer', 'model', 'serial_number', 'manufacture_year', 'registered_on', 'inv_number',
  'revision_ids', 'price_czk', 'note', 'alt_designation', 'zone', 'category', 'condition', 'data_source',
  'match_status', 'discrepancy_note', 'source_sheet', 'manufacturer_raw',
];

const centres = csv(LOCATION_HEADER, [
  { id: '50', name: 'Anděl', type: 'STORE', address: 'Ostrovského 33/2, 150 00 Praha 5', address_check: 'odvozeno' },
  { id: '620', name: 'Vestec Centrála', type: 'HQ', address: 'Na Spojce 670, 252 50 Vestec' },
  { id: '56', name: 'Psáry - Sklad', type: 'WAREHOUSE' },
]);

const item = (over: Record<string, string>) => ({ location_id: '50', name: 'Položka', match_status: 'OK', ...over });

const stock = csv(ITEM_HEADER, [
  item({
    name: 'Lednice, 2 ks',
    manufacturer: 'Liebherr',
    model: 'FRFVG 6501',
    serial_number: '86.309.114.6',
    manufacture_year: '2019',
    registered_on: '2024-12-27',
    inv_number: '2024003',
    revision_ids: 'S 172, S 176',
    price_czk: '39440.5',
    data_source: 'DlouhHM+ILKO',
    match_status: 'SPORNÉ',
    discrepancy_note: 'Revízia našla 2 kusy.',
    alt_designation: 'FRFvg 6501',
  }),
  item({ name: 'Lednice', manufacturer: 'LIEBHERR', revision_ids: 'S 176', data_source: 'ILKO', match_status: 'NOVÉ' }),
  item({ location_id: '620', name: 'Tiskárna', inv_number: '2024003', zone: 'Zázemí', manufacturer_raw: 'bez štítku' }),
]);

describe('inventory import', () => {
  const t = useTestDb();
  const options = { locationsCsv: centres, itemsCsv: stock, password: 'import-test-password' };

  it('fills an empty database through the app role and reports what it did', async () => {
    expect(await importInventory(t().app, options)).toEqual({
      users: 3,
      locations: 3,
      manufacturers: 1,
      items: 3,
      externalIds: 4,
      skippedRevisionIds: 1,
    });
  });

  it('makes each centre a top-level location with its number as the ID, its type and address', async () => {
    await importInventory(t().app, options);
    const rows = await t()
      .app.select({ code: locations.code, name: locations.name, parentId: locations.parentId, type: locationTypes.code, address: locations.address })
      .from(locations)
      .innerJoin(locationTypes, eq(locationTypes.id, locations.locationTypeId))
      .orderBy(asc(locations.code));
    expect(rows).toEqual([
      { code: '50', name: 'Anděl', parentId: null, type: 'STORE', address: 'Ostrovského 33/2, 150 00 Praha 5' },
      { code: '56', name: 'Psáry - Sklad', parentId: null, type: 'WAREHOUSE', address: null },
      { code: '620', name: 'Vestec Centrála', parentId: null, type: 'HQ', address: 'Na Spojce 670, 252 50 Vestec' },
    ]);
  });

  it('keeps the item fields, the price and one manufacturer per name regardless of case', async () => {
    await importInventory(t().app, options);
    const [fridge] = await t().app.select().from(items).where(eq(items.name, 'Lednice, 2 ks'));
    expect(fridge).toMatchObject({
      model: 'FRFVG 6501',
      serialNumber: '86.309.114.6',
      manufactureYear: 2019,
      registeredOn: '2024-12-27',
      purchasePrice: 39440.5,
    });
    expect(fridge!.code).toMatch(/^INV-\d{5}$/);
    expect(await t().app.select({ name: manufacturers.name }).from(manufacturers)).toEqual([{ name: 'Liebherr' }]);
  });

  it('scopes inventory numbers by centre and keeps a repeated revision ID on the first item only', async () => {
    await importInventory(t().app, options);
    const ids = await t()
      .app.select({ item: items.name, source: itemExternalIds.source, value: itemExternalIds.value })
      .from(itemExternalIds)
      .innerJoin(items, eq(items.id, itemExternalIds.itemId))
      .orderBy(asc(itemExternalIds.source), asc(itemExternalIds.value));
    expect(ids).toEqual([
      { item: 'Lednice, 2 ks', source: 'Inv. č. stř. 50', value: '2024003' },
      { item: 'Tiskárna', source: 'Inv. č. stř. 620', value: '2024003' },
      { item: 'Lednice, 2 ks', source: 'Revize ILKO', value: 'S 172' },
      { item: 'Lednice, 2 ks', source: 'Revize ILKO', value: 'S 176' },
    ]);
    const found = await createItemRepository(t().app).list({ q: 's 172' }, { limit: 50 });
    expect(found.items.map((i) => i.name)).toEqual(['Lednice, 2 ks']);
  });

  it('writes the extra columns into the note, in Czech', async () => {
    await importInventory(t().app, options);
    const notes = Object.fromEntries(
      (await t().app.select({ name: items.name, note: items.note }).from(items)).map((r) => [r.name, r.note]),
    );
    expect(notes['Lednice, 2 ks']).toBe(
      'Alternativní označení: FRFvg 6501\nZdroj dat: DlouhHM+ILKO\nK ověření: Revízia našla 2 kusy.',
    );
    expect(notes.Lednice).toBe(
      'Zdroj dat: ILKO\nJen v revizi elektrikáře, chybí ve finanční evidenci.\nID revize S 176 je uvedeno i u jiné položky.',
    );
    expect(notes.Tiskárna).toBe('Zóna: Zázemí\nVýrobce ve zdroji: bez štítku');
  });

  it('refuses a database that already has data', async () => {
    await importInventory(t().app, options);
    await expect(importInventory(t().app, options)).rejects.toBeInstanceOf(ImportRefusedError);
    expect((await t().app.select({ n: count() }).from(user))[0]!.n).toBe(3);
  });

  it('stops at a bad row and leaves the database empty', async () => {
    const bad = [
      csv(ITEM_HEADER, [item({ location_id: '99', name: 'Nikde' })]),
      csv(ITEM_HEADER, [item({ name: 'Budoucí', manufacture_year: '2999' })]),
      csv(ITEM_HEADER, [item({ name: 'Záporná', price_czk: '-1' })]),
    ];
    await expect(importInventory(t().app, { ...options, itemsCsv: bad[0]! })).rejects.toThrow('record 1 (Nikde): unknown location 99');
    await expect(importInventory(t().app, { ...options, itemsCsv: bad[1]! })).rejects.toThrow('manufactureYear');
    await expect(importInventory(t().app, { ...options, itemsCsv: bad[2]! })).rejects.toThrow('purchasePrice');
    await expect(
      importInventory(t().app, { ...options, locationsCsv: csv(LOCATION_HEADER, [{ id: '1', name: 'X', type: 'MOON' }]) }),
    ).rejects.toThrow('unknown location type "MOON"');
    for (const table of [user, locations, items]) {
      expect((await t().app.select({ n: count() }).from(table))[0]!.n).toBe(0);
    }
  });
});
