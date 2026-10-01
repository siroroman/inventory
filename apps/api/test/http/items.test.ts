import { itemDetailSchema, itemListSchema, itemSchema } from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, locations, manufacturers } from '../../src/db/schema/index.ts';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation, insertManufacturer } from '../helpers/factories.ts';
import { expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';
const DRIVE = 'https://drive.google.com/drive/folders/abc';

async function setup() {
  const { app } = createTestApp(db().app);
  return roleClients(app, db().app);
}

const archiveLocationRow = (id: string) =>
  db().app.update(locations).set({ archivedAt: new Date() }).where(eq(locations.id, id));
const archiveManufacturerRow = (id: string) =>
  db().app.update(manufacturers).set({ archivedAt: new Date() }).where(eq(manufacturers.id, id));

async function auditOf(id: string) {
  return db()
    .app.select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'item'), eq(auditLog.entityId, id)))
    .orderBy(auditLog.id);
}

describe('GET /items', () => {
  it('lists active items in Czech alphabetical order, with location path and manufacturer', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const kuchyne = await insertLocation(db().app, { name: 'Kuchyně', parentId: praha.id });
    const rational = await insertManufacturer(db().app, { name: 'Rational' });
    for (const name of ['Zapékač', 'Čistička', 'Sporák']) await insertItem(db().app, { name, locationId: kuchyne.id });
    await insertItem(db().app, { name: 'Konvektomat', locationId: kuchyne.id, manufacturerId: rational.id, model: 'iCombi' });

    const body = await expectJson(await read.get('/items'), 200, itemListSchema);
    expect(body.items.map((i) => i.name)).toEqual(['Čistička', 'Konvektomat', 'Sporák', 'Zapékač']);
    expect(body).toMatchObject({ total: 4, nextCursor: null });
    expect(body.items[1]).toMatchObject({
      model: 'iCombi',
      manufacturer: { id: rational.id, name: 'Rational' },
      location: { id: kuchyne.id, name: 'Kuchyně' },
      path: [{ name: 'Praha' }, { name: 'Kuchyně' }],
    });
    expect(body.items[1]?.code).toMatch(/^INV-\d{5}$/);
  });

  it('searches name, code, serial number, model and manufacturer, ignoring case and diacritics', async () => {
    const { read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const rational = await insertManufacturer(db().app, { name: 'Rational' });
    const a = await insertItem(db().app, { name: 'Čistička', locationId: loc.id });
    const b = await insertItem(db().app, { name: 'Váha', locationId: loc.id, serialNumber: 'SN-Žluťoučký-7' });
    const c = await insertItem(db().app, { name: 'Sporák', locationId: loc.id, model: 'Model ŠTĚPÁN' });
    const d = await insertItem(db().app, { name: 'Pec', locationId: loc.id, manufacturerId: rational.id });
    const cases: [string, string][] = [
      ['CISTICKA', a.name],
      [a.code.toLowerCase(), a.name],
      ['zlutoucky', b.name],
      ['stepan', c.name],
      ['RATIONAL', d.name],
    ];
    for (const [q, name] of cases) {
      const body = await expectJson(await read.get(`/items?q=${encodeURIComponent(q)}`), 200, itemListSchema);
      expect(body.items.map((i) => i.name), q).toEqual([name]);
    }
  });

  it('finds an item by any of its external IDs', async () => {
    const { read, write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    await write.post('/items', {
      name: 'Konvektomat',
      locationId: loc.id,
      externalIds: [
        { source: 'Elektrikář', value: 'EL-4821' },
        { source: 'Servis', value: 'A-77' },
      ],
    });
    await insertItem(db().app, { name: 'Váha', locationId: loc.id });

    for (const q of ['EL-4821', 'el-48', 'a-77']) {
      const body = await expectJson(await read.get(`/items?q=${q}`), 200, itemListSchema);
      expect(body.items.map((i) => i.name), q).toEqual(['Konvektomat']);
    }
  });

  it('finds an item by the name of a location on its path', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const kuchyne = await insertLocation(db().app, { name: 'Kuchyně', parentId: praha.id });
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await insertItem(db().app, { name: 'Konvektomat', locationId: kuchyne.id });
    await insertItem(db().app, { name: 'Váha', locationId: brno.id });

    for (const q of ['praha', 'kuchyne']) {
      const body = await expectJson(await read.get(`/items?q=${q}`), 200, itemListSchema);
      expect(body.items.map((i) => i.name), q).toEqual(['Konvektomat']);
    }
  });

  it('filters by location including its sub-locations, and by manufacturer', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const kuchyne = await insertLocation(db().app, { name: 'Kuchyně', parentId: praha.id });
    const brno = await insertLocation(db().app, { name: 'Brno' });
    const rational = await insertManufacturer(db().app, { name: 'Rational' });
    await insertItem(db().app, { name: 'Konvektomat', locationId: kuchyne.id, manufacturerId: rational.id });
    await insertItem(db().app, { name: 'Váha', locationId: praha.id });
    await insertItem(db().app, { name: 'Cizí', locationId: brno.id, manufacturerId: rational.id });

    const inPraha = await expectJson(await read.get(`/items?locationId=${praha.id}`), 200, itemListSchema);
    expect(inPraha.items.map((i) => i.name)).toEqual(['Konvektomat', 'Váha']);
    expect(inPraha.total).toBe(2);
    const byMaker = await expectJson(await read.get(`/items?manufacturerId=${rational.id}`), 200, itemListSchema);
    expect(byMaker.items.map((i) => i.name)).toEqual(['Cizí', 'Konvektomat']);
    const both = await expectJson(await read.get(`/items?manufacturerId=${rational.id}&locationId=${praha.id}&q=konv`), 200, itemListSchema);
    expect(both.items.map((i) => i.name)).toEqual(['Konvektomat']);
  });

  it('leaves archived items out', async () => {
    const { read, write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const item = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    await write.post(`/items/${item.id}/archive`, { version: 1 });
    expect((await expectJson(await read.get('/items'), 200, itemListSchema)).items).toEqual([]);
  });

  it('lists the archived items, and only those, with ?archived=true', async () => {
    const { read, write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const item = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    await insertItem(db().app, { name: 'Regál', locationId: loc.id });
    await write.post(`/items/${item.id}/archive`, { version: 1 });

    const body = await expectJson(await read.get('/items?archived=true'), 200, itemListSchema);
    expect(body.items.map((i) => i.name)).toEqual(['Váha']);
    expect(body.total).toBe(1);
    expect(body.items[0]?.archivedAt).toEqual(expect.any(String));
    expect((await expectJson(await read.get('/items?archived=true&q=regal'), 200, itemListSchema)).items).toEqual([]);
    await expectProblem(await read.get('/items?archived=1'), 400, 'validation_error');
  });

  it('pages with limit and cursor', async () => {
    const { read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    for (const name of ['A', 'B', 'C']) await insertItem(db().app, { name, locationId: loc.id });

    const first = await expectJson(await read.get('/items?limit=2'), 200, itemListSchema);
    expect(first.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(first.total).toBe(3);
    const second = await expectJson(await read.get(`/items?limit=2&cursor=${first.nextCursor}`), 200, itemListSchema);
    expect(second.items.map((i) => i.name)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
  });

  it('treats a blank search as no search', async () => {
    const { read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    const body = await expectJson(await read.get('/items?q=%20%20'), 200, itemListSchema);
    expect(body.items.map((i) => i.name)).toEqual(['Váha']);
  });

  it('rejects a bad limit, cursor and filter with 400', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/items?limit=0'), 400, 'validation_error');
    await expectProblem(await read.get('/items?cursor=garbage'), 400, 'invalid_cursor');
    await expectProblem(await read.get('/items?locationId=nope'), 400, 'validation_error');
    await expectProblem(await read.get('/items?manufacturerId=nope'), 400, 'validation_error');
  });
});

describe('GET /items/{id}', () => {
  it('returns every field with the location path and the external IDs', async () => {
    const { read, write } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const kuchyne = await insertLocation(db().app, { name: 'Kuchyně', parentId: praha.id });
    const rational = await insertManufacturer(db().app, { name: 'Rational' });
    const created = await expectJson(
      await write.post('/items', {
        name: 'Konvektomat',
        locationId: kuchyne.id,
        manufacturerId: rational.id,
        model: 'iCombi Pro',
        serialNumber: 'SN-1',
        manufactureYear: 2019,
        registeredOn: '2020-01-15',
        warrantyUntil: '2022-01-15',
        lastServiceOn: '2025-11-01',
        nextServiceOn: '2026-11-01',
        documentsUrl: DRIVE,
        note: 'Vedle výdejního okénka',
        externalIds: [
          { source: 'Servis', value: 'A-1' },
          { source: 'Elektrikář', value: 'EL-4821' },
        ],
      }),
      201,
      itemSchema,
    );

    const body = await expectJson(await read.get(`/items/${created.id}`), 200, itemDetailSchema);
    expect(body).toEqual({ ...created, photos: [] });
    expect(body).toMatchObject({
      name: 'Konvektomat',
      manufacturer: { id: rational.id, name: 'Rational' },
      location: { id: kuchyne.id, name: 'Kuchyně' },
      path: [{ name: 'Praha' }, { name: 'Kuchyně' }],
      manufactureYear: 2019,
      registeredOn: '2020-01-15',
      warrantyUntil: '2022-01-15',
      lastServiceOn: '2025-11-01',
      nextServiceOn: '2026-11-01',
      documentsUrl: DRIVE,
      note: 'Vedle výdejního okénka',
      externalIds: [
        { source: 'Elektrikář', value: 'EL-4821' },
        { source: 'Servis', value: 'A-1' },
      ],
      version: 1,
      archivedAt: null,
    });
  });

  it('returns archived items too, and 404 for an unknown one', async () => {
    const { read, write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const item = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    await write.post(`/items/${item.id}/archive`, { version: 1 });
    const body = await expectJson(await read.get(`/items/${item.id}`), 200, itemDetailSchema);
    expect(body.archivedAt).toEqual(expect.any(String));
    await expectProblem(await read.get(`/items/${MISSING}`), 404, 'not_found');
  });

  it('answers 400 for an id that is not a UUID', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/items/nope'), 400, 'validation_error');
  });
});

describe('POST /items', () => {
  it('creates an item with a generated code, trimming text and clearing what was not sent', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const body = await expectJson(await write.post('/items', { name: '  Váha ', locationId: loc.id }), 201, itemSchema);
    expect(body).toMatchObject({
      name: 'Váha',
      location: { id: loc.id },
      manufacturer: null,
      model: null,
      serialNumber: null,
      manufactureYear: null,
      documentsUrl: null,
      note: null,
      externalIds: [],
      version: 1,
    });
    expect(body.code).toMatch(/^INV-\d{5}$/);
  });

  it('takes the ID the user chose, upper-cased and trimmed, and leaves the generated ones alone', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const body = await expectJson(await write.post('/items', { name: 'Váha', locationId: loc.id, code: ' vaha-1.a ' }), 201, itemSchema);
    expect(body.code).toBe('VAHA-1.A');
    const next = await expectJson(await write.post('/items', { name: 'Další', locationId: loc.id }), 201, itemSchema);
    expect(next.code).toMatch(/^INV-\d{5}$/);
  });

  it('answers 409 when the chosen ID is taken, whatever its case', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    await write.post('/items', { name: 'A', locationId: loc.id, code: 'VAHA-1' });
    await expectProblem(await write.post('/items', { name: 'B', locationId: loc.id, code: 'vaha-1' }), 409, 'duplicate_item_code');
  });

  it('refuses to change the ID of an existing item', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const made = await expectJson(await write.post('/items', { name: 'A', locationId: loc.id }), 201, itemSchema);
    await expectProblem(await write.patch(`/items/${made.id}`, { version: 1, code: 'NEW-1' }), 400, 'validation_error');
  });

  it('creates an item without a location', async () => {
    const { write, read } = await setup();
    const body = await expectJson(await write.post('/items', { name: 'Váha' }), 201, itemSchema);
    expect(body).toMatchObject({ location: null, path: [] });
    const detail = await expectJson(await read.get(`/items/${body.id}`), 200, itemDetailSchema);
    expect(detail).toMatchObject({ location: null, path: [] });
    const list = await expectJson(await read.get('/items?q=vaha'), 200, itemListSchema);
    expect(list.items).toMatchObject([{ name: 'Váha', location: null, path: [] }]);
  });

  it('gives each item its own code', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const one = await expectJson(await write.post('/items', { name: 'A', locationId: loc.id }), 201, itemSchema);
    const two = await expectJson(await write.post('/items', { name: 'A', locationId: loc.id }), 201, itemSchema);
    expect(two.code).not.toBe(one.code);
  });

  it('saves external IDs trimmed, allows the same value under another source and audits them', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    await write.post('/items', { name: 'A', locationId: loc.id, externalIds: [{ source: 'Elektrikář', value: 'X-1' }] });
    const body = await expectJson(
      await write.post('/items', { name: 'B', locationId: loc.id, externalIds: [{ source: ' Servis ', value: ' X-1 ' }] }),
      201,
      itemSchema,
    );
    expect(body.externalIds).toEqual([{ source: 'Servis', value: 'X-1' }]);

    const [entry, ...rest] = await auditOf(body.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'create' });
    expect(entry?.changes).toMatchObject({ name: { to: 'B' }, externalIds: { from: null, to: ['Servis: X-1'] } });
  });

  it('answers 422 for an unknown or archived location and manufacturer, creating nothing', async () => {
    const { write, read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const archivedLoc = await insertLocation(db().app, { name: 'Zavřeno' });
    const maker = await insertManufacturer(db().app, { name: 'Rational' });
    await archiveLocationRow(archivedLoc.id);
    await archiveManufacturerRow(maker.id);

    await expectProblem(await write.post('/items', { name: 'X', locationId: MISSING }), 422, 'location_not_found');
    await expectProblem(await write.post('/items', { name: 'X', locationId: archivedLoc.id }), 422, 'location_archived');
    await expectProblem(await write.post('/items', { name: 'X', locationId: loc.id, manufacturerId: MISSING }), 422, 'manufacturer_not_found');
    await expectProblem(await write.post('/items', { name: 'X', locationId: loc.id, manufacturerId: maker.id }), 422, 'manufacturer_archived');
    expect((await expectJson(await read.get('/items'), 200, itemListSchema)).items).toEqual([]);
  });

  it('answers 409 for an external ID that repeats in the item, ignoring case', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const problem = await expectProblem(
      await write.post('/items', {
        name: 'X',
        locationId: loc.id,
        externalIds: [
          { source: 'Elektrikář', value: 'EL-1' },
          { source: 'ELEKTRIKÁŘ', value: 'el-1' },
        ],
      }),
      409,
      'duplicate_external_id',
    );
    expect(problem.details).toEqual({ conflicts: [{ source: 'ELEKTRIKÁŘ', value: 'el-1', itemCode: null }] });
  });

  it('answers 409 for an external ID of another item, archived ones included, creating nothing', async () => {
    const { write, read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const first = await expectJson(
      await write.post('/items', { name: 'První', locationId: loc.id, externalIds: [{ source: 'Elektrikář', value: 'EL-1' }] }),
      201,
      itemSchema,
    );
    const clash = { name: 'Druhý', locationId: loc.id, externalIds: [{ source: 'elektrikář', value: 'el-1' }] };
    const problem = await expectProblem(await write.post('/items', clash), 409, 'duplicate_external_id');
    expect(problem.details).toEqual({ conflicts: [{ source: 'Elektrikář', value: 'EL-1', itemCode: first.code }] });

    await write.post(`/items/${first.id}/archive`, { version: 1 });
    await expectProblem(await write.post('/items', clash), 409, 'duplicate_external_id');
    expect((await expectJson(await read.get('/items?q=Druhý'), 200, itemListSchema)).items).toEqual([]);
    expect(await auditOf(first.id)).toHaveLength(2);
  });

  it('answers 400 for an invalid body', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const base = { name: 'X', locationId: loc.id };
    for (const body of [
      {},
      { locationId: loc.id },
      { ...base, name: '  ' },
      { ...base, locationId: 'nope' },
      { ...base, manufactureYear: 1949 },
      { ...base, manufactureYear: new Date().getFullYear() + 1 },
      { ...base, registeredOn: '15. 1. 2020' },
      { ...base, documentsUrl: 'https://evil.example/x' },
      // Zod once let these through and the database CHECK turned them into a 500.
      { ...base, documentsUrl: 'https://drive.google.com' },
      { ...base, documentsUrl: 'https://drive.google.com:8443/x' },
      { ...base, model: '' },
      { ...base, externalIds: [{ source: 'S' }] },
      { ...base, externalIds: Array.from({ length: 21 }, (_, i) => ({ source: 'S', value: `V${i}` })) },
      { ...base, code: 'bad code' },
    ]) {
      await expectProblem(await write.post('/items', body), 400, 'validation_error');
    }
  });
});

describe('PATCH /items/{id}', () => {
  async function item(overrides: Parameters<typeof insertItem>[1] = {}) {
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    return insertItem(db().app, { name: 'Konvektomat', locationId: loc.id, ...overrides });
  }

  it('changes the fields sent and clears an optional one with null', async () => {
    const { write } = await setup();
    const row = await item({ model: 'iCombi', note: 'Poznámka', warrantyUntil: '2030-01-01' });
    const renamed = await expectJson(
      await write.patch(`/items/${row.id}`, { version: 1, name: 'Konvektomat 2', nextServiceOn: '2026-12-01' }),
      200,
      itemSchema,
    );
    expect(renamed).toMatchObject({ name: 'Konvektomat 2', model: 'iCombi', nextServiceOn: '2026-12-01', version: 2 });
    const cleared = await expectJson(
      await write.patch(`/items/${row.id}`, { version: 2, model: null, note: null, warrantyUntil: null }),
      200,
      itemSchema,
    );
    expect(cleared).toMatchObject({ name: 'Konvektomat 2', model: null, note: null, warrantyUntil: null, version: 3 });
  });

  it('moves the item to another location and changes its manufacturer', async () => {
    const { write } = await setup();
    const row = await item();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    const maker = await insertManufacturer(db().app, { name: 'Rational' });
    const body = await expectJson(
      await write.patch(`/items/${row.id}`, { version: 1, locationId: brno.id, manufacturerId: maker.id }),
      200,
      itemSchema,
    );
    expect(body).toMatchObject({ location: { id: brno.id }, path: [{ name: 'Brno' }], manufacturer: { id: maker.id } });
    const unlinked = await expectJson(await write.patch(`/items/${row.id}`, { version: 2, manufacturerId: null }), 200, itemSchema);
    expect(unlinked.manufacturer).toBeNull();
  });

  it('replaces, keeps and clears the external IDs', async () => {
    const { write } = await setup();
    const row = await item();
    const path = `/items/${row.id}`;
    const set = await expectJson(
      await write.patch(path, { version: 1, externalIds: [{ source: 'A', value: '1' }, { source: 'B', value: '2' }] }),
      200,
      itemSchema,
    );
    expect(set).toMatchObject({ version: 2, externalIds: [{ source: 'A', value: '1' }, { source: 'B', value: '2' }] });
    const kept = await expectJson(await write.patch(path, { version: 2, note: 'x' }), 200, itemSchema);
    expect(kept.externalIds).toHaveLength(2);
    const replaced = await expectJson(await write.patch(path, { version: 3, externalIds: [{ source: 'A', value: '1' }] }), 200, itemSchema);
    expect(replaced.externalIds).toEqual([{ source: 'A', value: '1' }]);
    const cleared = await expectJson(await write.patch(path, { version: 4, externalIds: [] }), 200, itemSchema);
    expect(cleared.externalIds).toEqual([]);
  });

  it('lets an item keep its own external ID when it is saved again', async () => {
    const { write } = await setup();
    const row = await item();
    await write.patch(`/items/${row.id}`, { version: 1, externalIds: [{ source: 'A', value: '1' }] });
    const body = await expectJson(
      await write.patch(`/items/${row.id}`, { version: 2, externalIds: [{ source: 'a', value: '1' }, { source: 'B', value: '2' }] }),
      200,
      itemSchema,
    );
    expect(body.externalIds).toHaveLength(2);
  });

  it('audits only what changed, external IDs included', async () => {
    const { write } = await setup();
    const row = await item();
    await write.patch(`/items/${row.id}`, { version: 1, name: 'Nový', externalIds: [{ source: 'A', value: '1' }] });
    const entries = await auditOf(row.id);
    expect(entries.map((e) => e.action)).toEqual(['update']);
    expect(entries[0]?.changes).toEqual({
      name: { from: 'Konvektomat', to: 'Nový' },
      externalIds: { from: [], to: ['A: 1'] },
    });
  });

  it('answers 409 for an external ID of another item and changes nothing', async () => {
    const { write, read } = await setup();
    const one = await item({ name: 'První' });
    const two = await item({ name: 'Druhý' });
    await write.patch(`/items/${one.id}`, { version: 1, externalIds: [{ source: 'A', value: '1' }] });

    const problem = await expectProblem(
      await write.patch(`/items/${two.id}`, { version: 1, name: 'Přejmenovaný', externalIds: [{ source: 'a', value: '1' }] }),
      409,
      'duplicate_external_id',
    );
    expect(problem.details).toEqual({ conflicts: [{ source: 'A', value: '1', itemCode: one.code }] });
    expect(await expectJson(await read.get(`/items/${two.id}`), 200, itemSchema)).toMatchObject({
      name: 'Druhý',
      version: 1,
      externalIds: [],
    });
    expect(await auditOf(two.id)).toEqual([]);
  });

  it('answers 422 for an unknown or archived location and manufacturer', async () => {
    const { write } = await setup();
    const row = await item();
    const archivedLoc = await insertLocation(db().app, { name: 'Zavřeno' });
    const maker = await insertManufacturer(db().app, { name: 'Rational' });
    await archiveLocationRow(archivedLoc.id);
    await archiveManufacturerRow(maker.id);
    const path = `/items/${row.id}`;
    await expectProblem(await write.patch(path, { version: 1, locationId: MISSING }), 422, 'location_not_found');
    await expectProblem(await write.patch(path, { version: 1, locationId: archivedLoc.id }), 422, 'location_archived');
    await expectProblem(await write.patch(path, { version: 1, manufacturerId: MISSING }), 422, 'manufacturer_not_found');
    await expectProblem(await write.patch(path, { version: 1, manufacturerId: maker.id }), 422, 'manufacturer_archived');
  });

  it('answers 409 for a stale version and for an archived item, 404 for an unknown one', async () => {
    const { write } = await setup();
    const row = await item();
    await write.patch(`/items/${row.id}`, { version: 1, note: 'a' });
    await expectProblem(await write.patch(`/items/${row.id}`, { version: 1, note: 'b' }), 409, 'conflict');
    await write.post(`/items/${row.id}/archive`, { version: 2 });
    await expectProblem(await write.patch(`/items/${row.id}`, { version: 3, name: 'X' }), 409, 'archived');
    await expectProblem(await write.patch(`/items/${MISSING}`, { version: 1, name: 'X' }), 404, 'not_found');
  });

  it('answers 400 for a missing version, an unknown key and a bad value', async () => {
    const { write } = await setup();
    const row = await item();
    const path = `/items/${row.id}`;
    await expectProblem(await write.patch(path, { name: 'X' }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, code: 'INV-99999' }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, name: null }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, documentsUrl: 'https://drive.google.com' }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, manufactureYear: 1900 }), 400, 'validation_error');
  });

  it('gives an item a location and takes it away again with null', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const row = await item({ locationId: null });
    const placed = await expectJson(await write.patch(`/items/${row.id}`, { version: 1, locationId: loc.id }), 200, itemSchema);
    expect(placed).toMatchObject({ location: { id: loc.id }, path: [{ id: loc.id }] });
    const cleared = await expectJson(await write.patch(`/items/${row.id}`, { version: 2, locationId: null }), 200, itemSchema);
    expect(cleared).toMatchObject({ location: null, path: [] });
  });

  it('refuses an update that changes nothing, so the version stays put', async () => {
    const { write, read } = await setup();
    const row = await item();
    await expectProblem(await write.patch(`/items/${row.id}`, { version: 1 }), 400, 'validation_error');
    expect(await expectJson(await read.get(`/items/${row.id}`), 200, itemSchema)).toMatchObject({ version: 1 });
  });
});

describe('POST /items/{id}/archive and /restore', () => {
  it('archives and restores, keeping the version in step and auditing both', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const row = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    const archived = await expectJson(await write.post(`/items/${row.id}/archive`, { version: 1 }), 200, itemSchema);
    expect(archived).toMatchObject({ version: 2, archivedAt: expect.any(String), name: 'Váha' });
    const restored = await expectJson(await write.post(`/items/${row.id}/restore`, { version: 2 }), 200, itemSchema);
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
    expect((await auditOf(row.id)).map((e) => e.action)).toEqual(['archive', 'restore']);
  });

  it('comes back into the list after a restore', async () => {
    const { write, read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const row = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    await write.post(`/items/${row.id}/archive`, { version: 1 });
    await write.post(`/items/${row.id}/restore`, { version: 2 });
    expect((await expectJson(await read.get('/items'), 200, itemListSchema)).items.map((i) => i.name)).toEqual(['Váha']);
  });

  it('answers 409 for a stale version and for a wrong state, 404 for an unknown id', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const row = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    await expectProblem(await write.post(`/items/${row.id}/restore`, { version: 1 }), 409, 'not_archived');
    await expectProblem(await write.post(`/items/${row.id}/archive`, { version: 7 }), 409, 'conflict');
    await write.post(`/items/${row.id}/archive`, { version: 1 });
    await expectProblem(await write.post(`/items/${row.id}/archive`, { version: 2 }), 409, 'archived');
    await expectProblem(await write.post(`/items/${MISSING}/archive`, { version: 1 }), 404, 'not_found');
  });

  it('answers 400 without a version', async () => {
    const { write } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const row = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    await expectProblem(await write.post(`/items/${row.id}/archive`, {}), 400, 'validation_error');
  });
});

describe('roles on the item routes', () => {
  it('lets read users read but not write', async () => {
    const { read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    const row = await insertItem(db().app, { name: 'Váha', locationId: loc.id });
    for (const path of ['/items', `/items/${row.id}`]) expect((await read.get(path)).status, path).toBe(200);
    await expectProblem(await read.post('/items', { name: 'X', locationId: loc.id }), 403, 'forbidden');
    await expectProblem(await read.patch(`/items/${row.id}`, { version: 1, name: 'X' }), 403, 'forbidden');
    await expectProblem(await read.post(`/items/${row.id}/archive`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.post(`/items/${row.id}/restore`, { version: 1 }), 403, 'forbidden');
  });

  it('lets write and admin users write', async () => {
    const { write, admin } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    expect((await write.post('/items', { name: 'A', locationId: loc.id })).status).toBe(201);
    expect((await admin.post('/items', { name: 'B', locationId: loc.id })).status).toBe(201);
  });

  it('changes nothing when a request is refused', async () => {
    const { read } = await setup();
    const loc = await insertLocation(db().app, { name: 'Sklad' });
    await read.post('/items', { name: 'X', locationId: loc.id });
    expect((await expectJson(await read.get('/items'), 200, itemListSchema)).items).toEqual([]);
  });
});
