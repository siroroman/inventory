import {
  itemListSchema,
  locationListSchema,
  locationSchema,
  locationTypeListSchema,
  locationTypeSchema,
} from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation, insertManufacturer, locationTypeId } from '../helpers/factories.ts';
import { expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

async function setup() {
  const { app } = createTestApp(db().app);
  return { app, ...(await roleClients(app, db().app)), hq: await locationTypeId(db().app) };
}

describe('GET /locations', () => {
  it('lists the top level by default, by name', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    await insertLocation(db().app, { name: 'Ostrava' });
    await insertLocation(db().app, { name: 'Přízemí', parentId: praha.id });

    const body = await expectJson(await read.get('/locations'), 200, locationListSchema);
    expect(body.items.map((l) => l.name)).toEqual(['Ostrava', 'Praha']);
    expect(body).toMatchObject({ total: 2, nextCursor: null });
    expect(body.items[1]).toMatchObject({ type: { code: 'HQ' }, childCount: 1, path: [{ name: 'Praha' }] });
  });

  it('lists the children of one location with ?parentId=', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const floor = await insertLocation(db().app, { name: 'Přízemí', parentId: praha.id });
    await insertLocation(db().app, { name: 'Kuchyně', parentId: floor.id });

    const body = await expectJson(await read.get(`/locations?parentId=${praha.id}`), 200, locationListSchema);
    expect(body.items.map((l) => l.name)).toEqual(['Přízemí']);
    expect(body.items[0]).toMatchObject({ type: null, parentId: praha.id, childCount: 1 });
  });

  it('searches every level when ?q= is given without a parent, ignoring case and diacritics', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    await insertLocation(db().app, { name: 'Teplá kuchyňa', parentId: praha.id });

    const body = await expectJson(await read.get('/locations?q=KUCHYNA'), 200, locationListSchema);
    expect(body.items.map((l) => l.name)).toEqual(['Teplá kuchyňa']);
    expect(body.items[0]?.path.map((s) => s.name)).toEqual(['Praha', 'Teplá kuchyňa']);
  });

  it('leaves archived locations out', async () => {
    const { read, write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await write.post(`/locations/${brno.id}/archive`, { version: 1 });
    expect((await expectJson(await read.get('/locations'), 200, locationListSchema)).items).toEqual([]);
  });

  it('pages with limit and cursor', async () => {
    const { read } = await setup();
    for (const name of ['A', 'B', 'C']) await insertLocation(db().app, { name });

    const first = await expectJson(await read.get('/locations?limit=2'), 200, locationListSchema);
    expect(first.items.map((l) => l.name)).toEqual(['A', 'B']);
    expect(first.total).toBe(3);
    const second = await expectJson(await read.get(`/locations?limit=2&cursor=${first.nextCursor}`), 200, locationListSchema);
    expect(second.items.map((l) => l.name)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
  });

  it('treats a blank search as no search', async () => {
    const { read } = await setup();
    await insertLocation(db().app, { name: 'Praha' });
    for (const q of ['', '%20%20']) {
      const body = await expectJson(await read.get(`/locations?q=${q}`), 200, locationListSchema);
      expect(body.items.map((l) => l.name), q).toEqual(['Praha']);
    }
  });

  it('rejects a bad parentId, limit and cursor with 400', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/locations?parentId=nope'), 400, 'validation_error');
    await expectProblem(await read.get('/locations?limit=0'), 400, 'validation_error');
    await expectProblem(await read.get('/locations?cursor=garbage'), 400, 'invalid_cursor');
  });
});

describe('GET /locations/{id}', () => {
  it('returns the path, the type and the counts over the whole subtree', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha', address: 'Nádražní 1' });
    const floor = await insertLocation(db().app, { name: 'Přízemí', parentId: praha.id });
    await insertItem(db().app, { locationId: praha.id });
    await insertItem(db().app, { locationId: floor.id });

    const floorBody = await expectJson(await read.get(`/locations/${floor.id}`), 200, locationSchema);
    expect(floorBody.path.map((s) => s.name)).toEqual(['Praha', 'Přízemí']);
    expect(floorBody).toMatchObject({ itemCount: 1, childCount: 0, type: null, parentId: praha.id });

    const body = await expectJson(await read.get(`/locations/${praha.id}`), 200, locationSchema);
    expect(body).toMatchObject({ code: praha.code, address: 'Nádražní 1', itemCount: 2, childCount: 1, version: 1, archivedAt: null });
  });

  it('still returns an archived location, so it can be restored', async () => {
    const { read, write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await write.post(`/locations/${brno.id}/archive`, { version: 1 });
    const body = await expectJson(await read.get(`/locations/${brno.id}`), 200, locationSchema);
    expect(body.archivedAt).not.toBeNull();
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    const { read } = await setup();
    await expectProblem(await read.get(`/locations/${MISSING}`), 404, 'not_found');
    await expectProblem(await read.get('/locations/not-a-uuid'), 400, 'validation_error');
  });
});

describe('GET /locations/{id}/items', () => {
  it('lists the items of the location and all its sub-locations', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const floor = await insertLocation(db().app, { name: 'Přízemí', parentId: praha.id });
    const other = await insertLocation(db().app, { name: 'Brno' });
    const maker = await insertManufacturer(db().app, { name: 'Rational' });
    await insertItem(db().app, { name: 'Konvektomat', locationId: floor.id, manufacturerId: maker.id, model: 'iCombi' });
    await insertItem(db().app, { name: 'Váha', locationId: praha.id });
    await insertItem(db().app, { name: 'Cizí', locationId: other.id });

    const body = await expectJson(await read.get(`/locations/${praha.id}/items`), 200, itemListSchema);
    expect(body.items.map((i) => i.name)).toEqual(['Konvektomat', 'Váha']);
    expect(body.total).toBe(2);
    expect(body.items[0]).toMatchObject({
      manufacturer: { name: 'Rational' },
      model: 'iCombi',
      location: { name: 'Přízemí' },
      path: [{ name: 'Praha' }, { name: 'Přízemí' }],
    });
  });

  it('filters by ?q=', async () => {
    const { read } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    await insertItem(db().app, { name: 'Konvektomat', locationId: praha.id });
    await insertItem(db().app, { name: 'Váha', locationId: praha.id });
    const body = await expectJson(await read.get(`/locations/${praha.id}/items?q=vaha`), 200, itemListSchema);
    expect(body.items.map((i) => i.name)).toEqual(['Váha']);
  });

  it('answers 404 for an unknown location', async () => {
    const { read } = await setup();
    await expectProblem(await read.get(`/locations/${MISSING}/items`), 404, 'not_found');
  });
});

describe('POST /locations', () => {
  it('creates a top-level location with its type', async () => {
    const { write, hq } = await setup();
    const res = await write.post('/locations', { name: '  Centrála Praha ', locationTypeId: hq, address: 'Nádražní 1' });
    const body = await expectJson(res, 201, locationSchema);
    expect(body).toMatchObject({
      name: 'Centrála Praha',
      code: expect.stringMatching(/^LOC-\d{3}$/),
      type: { code: 'HQ' },
      parentId: null,
      address: 'Nádražní 1',
      note: null,
      itemCount: 0,
      childCount: 0,
      version: 1,
    });
  });

  it('takes the ID the user chose, upper-cased and trimmed', async () => {
    const { write, hq } = await setup();
    const body = await expectJson(await write.post('/locations', { name: 'Sklad', locationTypeId: hq, code: ' sklad-a.1 ' }), 201, locationSchema);
    expect(body.code).toBe('SKLAD-A.1');
    // The next generated ID is not disturbed.
    const next = await expectJson(await write.post('/locations', { name: 'Jiný', locationTypeId: hq }), 201, locationSchema);
    expect(next.code).toMatch(/^LOC-\d{3}$/);
  });

  it('answers 409 when the chosen ID is taken, whatever its case', async () => {
    const { write, hq } = await setup();
    await write.post('/locations', { name: 'Sklad', locationTypeId: hq, code: 'SKLAD-A' });
    await expectProblem(await write.post('/locations', { name: 'Jiný', locationTypeId: hq, code: 'sklad-a' }), 409, 'duplicate_location_code');
  });

  it('creates a sub-location without a type', async () => {
    const { write } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const body = await expectJson(await write.post('/locations', { name: 'Přízemí', parentId: praha.id }), 201, locationSchema);
    expect(body).toMatchObject({ type: null, parentId: praha.id });
    expect(body.path.map((s) => s.name)).toEqual(['Praha', 'Přízemí']);
  });

  it('answers 422 for each placement mistake', async () => {
    const { write, hq } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const old = await insertLocation(db().app, { name: 'Stará' });
    await write.post(`/locations/${old.id}/archive`, { version: 1 });

    await expectProblem(await write.post('/locations', { name: 'X' }), 422, 'location_type_required');
    await expectProblem(await write.post('/locations', { name: 'X', parentId: praha.id, locationTypeId: hq }), 422, 'location_type_not_allowed');
    await expectProblem(await write.post('/locations', { name: 'X', parentId: MISSING }), 422, 'parent_not_found');
    await expectProblem(await write.post('/locations', { name: 'X', parentId: old.id }), 422, 'parent_archived');
    await expectProblem(await write.post('/locations', { name: 'X', locationTypeId: MISSING }), 422, 'location_type_not_found');
  });

  it('answers 400 for an invalid body', async () => {
    const { write, hq } = await setup();
    await expectProblem(await write.post('/locations', { locationTypeId: hq }), 400, 'validation_error');
    await expectProblem(await write.post('/locations', { name: '   ', locationTypeId: hq }), 400, 'validation_error');
    await expectProblem(await write.post('/locations', { name: 'X', locationTypeId: 'nope' }), 400, 'validation_error');
    for (const code of ['', 'bad code', 'ČÁRKA', '-A', '/q', 'X'.repeat(31)]) {
      await expectProblem(await write.post('/locations', { name: 'X', locationTypeId: hq, code }), 400, 'validation_error');
    }
    await expectProblem(await write.post('/locations', { name: 'x'.repeat(121), locationTypeId: hq }), 400, 'validation_error');
  });
});

describe('PATCH /locations/{id}', () => {
  it('changes the fields sent and clears one with null', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno', address: 'Stará 1', note: 'pozn.' });
    const body = await expectJson(
      await write.patch(`/locations/${brno.id}`, { version: 1, name: 'Brno střed', address: null }),
      200,
      locationSchema,
    );
    expect(body).toMatchObject({ name: 'Brno střed', address: null, note: 'pozn.', version: 2 });
  });

  it('moves a location under a parent, which drops its type', async () => {
    const { write } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const brno = await insertLocation(db().app, { name: 'Brno' });
    const body = await expectJson(await write.patch(`/locations/${brno.id}`, { version: 1, parentId: praha.id }), 200, locationSchema);
    expect(body).toMatchObject({ parentId: praha.id, type: null });
    expect(body.path.map((s) => s.name)).toEqual(['Praha', 'Brno']);
  });

  it('answers 409 for a stale version', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await write.patch(`/locations/${brno.id}`, { version: 1, name: 'Brno 2' });
    await expectProblem(await write.patch(`/locations/${brno.id}`, { version: 1, name: 'Brno 3' }), 409, 'conflict');
  });

  it('answers 409 when a move would make a location its own ancestor', async () => {
    const { write } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const floor = await insertLocation(db().app, { name: 'Přízemí', parentId: praha.id });
    await expectProblem(await write.patch(`/locations/${praha.id}`, { version: 1, parentId: floor.id }), 409, 'location_cycle');
    await expectProblem(await write.patch(`/locations/${praha.id}`, { version: 1, parentId: praha.id }), 409, 'location_cycle');
  });

  it('answers 409 for an archived location, 404 for an unknown one', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await write.post(`/locations/${brno.id}/archive`, { version: 1 });
    await expectProblem(await write.patch(`/locations/${brno.id}`, { version: 2, name: 'X' }), 409, 'archived');
    await expectProblem(await write.patch(`/locations/${MISSING}`, { version: 1, name: 'X' }), 404, 'not_found');
  });

  it('answers 422 when the result has no valid placement', async () => {
    const { write } = await setup();
    const praha = await insertLocation(db().app, { name: 'Praha' });
    const floor = await insertLocation(db().app, { name: 'Přízemí', parentId: praha.id });
    // Moving to the top level needs a type.
    await expectProblem(await write.patch(`/locations/${floor.id}`, { version: 1, parentId: null }), 422, 'location_type_required');
  });

  it('answers 400 for a missing version, an unknown key and a bad value', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await expectProblem(await write.patch(`/locations/${brno.id}`, { name: 'X' }), 400, 'validation_error');
    await expectProblem(await write.patch(`/locations/${brno.id}`, { version: 1, code: 'LOC-999' }), 400, 'validation_error');
    await expectProblem(await write.patch(`/locations/${brno.id}`, { version: 1, name: '' }), 400, 'validation_error');
    await expectProblem(await write.patch(`/locations/${brno.id}`, { version: 0, name: 'X' }), 400, 'validation_error');
  });

  it('refuses an update that changes nothing, so the version and the audit log stay put', async () => {
    const { write, read } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await expectProblem(await write.patch(`/locations/${brno.id}`, { version: 1 }), 400, 'validation_error');
    expect(await expectJson(await read.get(`/locations/${brno.id}`), 200, locationSchema)).toMatchObject({ version: 1 });
  });
});

describe('POST /locations/{id}/archive and /restore', () => {
  it('archives and restores, keeping the version in step', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    const archived = await expectJson(await write.post(`/locations/${brno.id}/archive`, { version: 1 }), 200, locationSchema);
    expect(archived).toMatchObject({ version: 2, archivedAt: expect.any(String) });
    const restored = await expectJson(await write.post(`/locations/${brno.id}/restore`, { version: 2 }), 200, locationSchema);
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
  });

  it('answers 409 for a stale version and for a wrong state, 404 for an unknown id', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await expectProblem(await write.post(`/locations/${brno.id}/restore`, { version: 1 }), 409, 'not_archived');
    await expectProblem(await write.post(`/locations/${brno.id}/archive`, { version: 7 }), 409, 'conflict');
    await write.post(`/locations/${brno.id}/archive`, { version: 1 });
    await expectProblem(await write.post(`/locations/${brno.id}/archive`, { version: 2 }), 409, 'archived');
    await expectProblem(await write.post(`/locations/${MISSING}/archive`, { version: 1 }), 404, 'not_found');
  });

  it('answers 400 without a version', async () => {
    const { write } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    await expectProblem(await write.post(`/locations/${brno.id}/archive`, {}), 400, 'validation_error');
  });
});

describe('roles on the location routes', () => {
  it('lets read users read but not write', async () => {
    const { read } = await setup();
    const brno = await insertLocation(db().app, { name: 'Brno' });
    for (const path of ['/locations', `/locations/${brno.id}`, `/locations/${brno.id}/items`, '/location-types']) {
      expect((await read.get(path)).status, path).toBe(200);
    }
    await expectProblem(await read.post('/locations', { name: 'X', locationTypeId: MISSING }), 403, 'forbidden');
    await expectProblem(await read.patch(`/locations/${brno.id}`, { version: 1, name: 'X' }), 403, 'forbidden');
    await expectProblem(await read.post(`/locations/${brno.id}/archive`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.post(`/locations/${brno.id}/restore`, { version: 1 }), 403, 'forbidden');
  });

  it('lets write and admin users write', async () => {
    const { write, admin, hq } = await setup();
    expect((await write.post('/locations', { name: 'A', locationTypeId: hq })).status).toBe(201);
    expect((await admin.post('/locations', { name: 'B', locationTypeId: hq })).status).toBe(201);
  });

  it('changes nothing when a request is refused', async () => {
    const { read, hq } = await setup();
    await read.post('/locations', { name: 'X', locationTypeId: hq });
    const body = await expectJson(await read.get('/locations'), 200, locationListSchema);
    expect(body.items).toEqual([]);
  });
});

describe('location types', () => {
  it('lists the seeded types in display order', async () => {
    const { read } = await setup();
    const body = await expectJson(await read.get('/location-types'), 200, locationTypeListSchema);
    expect(body.items.map((t) => t.code)).toEqual(['HQ', 'STORE', 'SITE', 'WAREHOUSE']);
  });

  it('lets an admin create and edit a type', async () => {
    const { admin, read } = await setup();
    const created = await expectJson(await admin.post('/location-types', { code: 'KIOSK', name: ' Kiosek ', sortOrder: 5 }), 201, locationTypeSchema);
    expect(created).toMatchObject({ code: 'KIOSK', name: 'Kiosek', sortOrder: 5, version: 1 });

    const updated = await expectJson(await admin.patch(`/location-types/${created.id}`, { version: 1, name: 'Stánek' }), 200, locationTypeSchema);
    expect(updated).toMatchObject({ code: 'KIOSK', name: 'Stánek', version: 2 });

    const list = await expectJson(await read.get('/location-types'), 200, locationTypeListSchema);
    expect(list.items.map((t) => t.code)).toEqual(['HQ', 'STORE', 'SITE', 'WAREHOUSE', 'KIOSK']);
  });

  it('answers 403 to read and write users', async () => {
    const { read, write } = await setup();
    for (const user of [read, write]) {
      await expectProblem(await user.post('/location-types', { code: 'KIOSK', name: 'Kiosek' }), 403, 'forbidden');
      await expectProblem(await user.patch(`/location-types/${MISSING}`, { version: 1, name: 'X' }), 403, 'forbidden');
    }
  });

  it('answers 409 for a duplicate code or name and for a stale version, 404 for an unknown id', async () => {
    const { admin } = await setup();
    await expectProblem(await admin.post('/location-types', { code: 'HQ', name: 'Jiná' }), 409, 'duplicate_location_type');
    await expectProblem(await admin.post('/location-types', { code: 'OTHER', name: 'Centrála' }), 409, 'duplicate_location_type');

    const kiosk = await expectJson(await admin.post('/location-types', { code: 'KIOSK', name: 'Kiosek' }), 201, locationTypeSchema);
    await expectProblem(await admin.patch(`/location-types/${kiosk.id}`, { version: 1, name: 'Sklad' }), 409, 'duplicate_location_type');
    await expectProblem(await admin.patch(`/location-types/${kiosk.id}`, { version: 9, name: 'Nový' }), 409, 'conflict');
    await expectProblem(await admin.patch(`/location-types/${MISSING}`, { version: 1, name: 'Nový' }), 404, 'not_found');
  });

  it('answers 400 for an invalid body', async () => {
    const { admin } = await setup();
    await expectProblem(await admin.post('/location-types', { code: 'lower case', name: 'X' }), 400, 'validation_error');
    await expectProblem(await admin.post('/location-types', { code: 'KIOSK' }), 400, 'validation_error');
    await expectProblem(await admin.post('/location-types', { code: 'KIOSK', name: 'X', sortOrder: -1 }), 400, 'validation_error');
    await expectProblem(await admin.patch(`/location-types/${MISSING}`, { name: 'X' }), 400, 'validation_error');
    await expectProblem(await admin.patch(`/location-types/${MISSING}`, { version: 1 }), 400, 'validation_error');
  });

  it('keeps the code fixed once a type exists', async () => {
    const { admin } = await setup();
    const kiosk = await expectJson(await admin.post('/location-types', { code: 'KIOSK', name: 'Kiosek' }), 201, locationTypeSchema);
    await expectProblem(await admin.patch(`/location-types/${kiosk.id}`, { version: 1, code: 'STAN' }), 400, 'validation_error');
  });
});
