import {
  manufacturerDetailSchema,
  manufacturerListSchema,
  manufacturerSchema,
  rankedProviderListSchema,
} from '@inventory/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { serviceProviders } from '../../src/db/schema/index.ts';
import { createTestApp, loginAs } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertManufacturer, insertProvider } from '../helpers/factories.ts';
import { api, expectJson, expectProblem } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

/** Service provider routes do not exist yet, so a provider is archived in the database. */
async function archiveProvider(id: string) {
  await db().app.update(serviceProviders).set({ archivedAt: new Date() }).where(eq(serviceProviders.id, id));
}

async function setup() {
  const { app } = createTestApp(db().app);
  const as = async (role: 'read' | 'write' | 'admin') => api(app, (await loginAs(app, db().app, role)).headers);
  return { read: await as('read'), write: await as('write'), admin: await as('admin') };
}

describe('GET /manufacturers', () => {
  it('lists active manufacturers in Czech alphabetical order', async () => {
    const { read } = await setup();
    for (const name of ['Zanussi', 'Čajka', 'Bosch', 'Electrolux']) await insertManufacturer(db().app, { name });

    const body = await expectJson(await read.get('/manufacturers'), 200, manufacturerListSchema);
    expect(body.items.map((m) => m.name)).toEqual(['Bosch', 'Čajka', 'Electrolux', 'Zanussi']);
    expect(body).toMatchObject({ total: 4, nextCursor: null });
  });

  it('searches by name, ignoring case and diacritics', async () => {
    const { read } = await setup();
    await insertManufacturer(db().app, { name: 'Čajka' });
    await insertManufacturer(db().app, { name: 'Bosch' });
    const body = await expectJson(await read.get('/manufacturers?q=CAJ'), 200, manufacturerListSchema);
    expect(body.items.map((m) => m.name)).toEqual(['Čajka']);
    expect(body.total).toBe(1);
  });

  it('leaves archived manufacturers out', async () => {
    const { read, write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await write.post(`/manufacturers/${bosch.id}/archive`, { version: 1 });
    expect((await expectJson(await read.get('/manufacturers'), 200, manufacturerListSchema)).items).toEqual([]);
  });

  it('pages with limit and cursor', async () => {
    const { read } = await setup();
    for (const name of ['A', 'B', 'C']) await insertManufacturer(db().app, { name });

    const first = await expectJson(await read.get('/manufacturers?limit=2'), 200, manufacturerListSchema);
    expect(first.items.map((m) => m.name)).toEqual(['A', 'B']);
    expect(first.total).toBe(3);
    const second = await expectJson(await read.get(`/manufacturers?limit=2&cursor=${first.nextCursor}`), 200, manufacturerListSchema);
    expect(second.items.map((m) => m.name)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
  });

  it('treats a blank search as no search', async () => {
    const { read } = await setup();
    await insertManufacturer(db().app, { name: 'Bosch' });
    const body = await expectJson(await read.get('/manufacturers?q=%20%20'), 200, manufacturerListSchema);
    expect(body.items.map((m) => m.name)).toEqual(['Bosch']);
  });

  it('rejects a bad limit and cursor with 400', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/manufacturers?limit=0'), 400, 'validation_error');
    await expectProblem(await read.get('/manufacturers?cursor=garbage'), 400, 'invalid_cursor');
  });
});

describe('GET /manufacturers/{id}', () => {
  it('returns the manufacturer with its providers in contact order', async () => {
    const { read, write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch', note: 'Německo' });
    const novak = await insertProvider(db().app, { name: 'Servis Novák', phone: '+420 111 222 333', email: 'novak@example.test' });
    const svoboda = await insertProvider(db().app, { name: 'Elektro Svoboda', contactPerson: 'Jan Svoboda' });
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [svoboda.id, novak.id] });

    const body = await expectJson(await read.get(`/manufacturers/${bosch.id}`), 200, manufacturerDetailSchema);
    expect(body).toMatchObject({ name: 'Bosch', note: 'Německo', version: 1 });
    expect(body.providers).toEqual([
      expect.objectContaining({ id: svoboda.id, name: 'Elektro Svoboda', contactPerson: 'Jan Svoboda', priority: 1, archivedAt: null }),
      expect.objectContaining({ id: novak.id, name: 'Servis Novák', phone: '+420 111 222 333', email: 'novak@example.test', priority: 2 }),
    ]);
    expect(body.providers[0]?.code).toMatch(/^SUP-\d{3}$/);
  });

  it('returns archived manufacturers too, and 404 for an unknown one', async () => {
    const { read, write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await write.post(`/manufacturers/${bosch.id}/archive`, { version: 1 });
    const body = await expectJson(await read.get(`/manufacturers/${bosch.id}`), 200, manufacturerDetailSchema);
    expect(body.archivedAt).toEqual(expect.any(String));
    expect(body.providers).toEqual([]);
    await expectProblem(await read.get(`/manufacturers/${MISSING}`), 404, 'not_found');
  });

  it('answers 400 for an id that is not a UUID', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/manufacturers/nope'), 400, 'validation_error');
  });
});

describe('POST /manufacturers', () => {
  it('creates a manufacturer, trimming the name', async () => {
    const { write } = await setup();
    const body = await expectJson(await write.post('/manufacturers', { name: '  Bosch ', note: 'Německo' }), 201, manufacturerSchema);
    expect(body).toMatchObject({ name: 'Bosch', note: 'Německo', version: 1, archivedAt: null });
  });

  it('answers 409 for a name that exists, ignoring case, archived ones included', async () => {
    const { write } = await setup();
    await expectJson(await write.post('/manufacturers', { name: 'Bosch' }), 201, manufacturerSchema);
    await expectProblem(await write.post('/manufacturers', { name: 'BOSCH' }), 409, 'duplicate_manufacturer');

    const old = await insertManufacturer(db().app, { name: 'Zanussi' });
    await write.post(`/manufacturers/${old.id}/archive`, { version: 1 });
    await expectProblem(await write.post('/manufacturers', { name: 'zanussi' }), 409, 'duplicate_manufacturer');
  });

  it('answers 400 for an invalid body', async () => {
    const { write } = await setup();
    await expectProblem(await write.post('/manufacturers', {}), 400, 'validation_error');
    await expectProblem(await write.post('/manufacturers', { name: '   ' }), 400, 'validation_error');
    await expectProblem(await write.post('/manufacturers', { name: 'x'.repeat(121) }), 400, 'validation_error');
    await expectProblem(await write.post('/manufacturers', { name: 'X', note: '' }), 400, 'validation_error');
    await expectProblem(await write.post('/manufacturers', { name: 'X', id: MISSING }), 400, 'validation_error');
  });
});

describe('PATCH /manufacturers/{id}', () => {
  it('changes the fields sent and clears the note with null', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch', note: 'Německo' });
    const renamed = await expectJson(await write.patch(`/manufacturers/${bosch.id}`, { version: 1, name: 'Bosch CZ' }), 200, manufacturerSchema);
    expect(renamed).toMatchObject({ name: 'Bosch CZ', note: 'Německo', version: 2 });
    const cleared = await expectJson(await write.patch(`/manufacturers/${bosch.id}`, { version: 2, note: null }), 200, manufacturerSchema);
    expect(cleared).toMatchObject({ name: 'Bosch CZ', note: null, version: 3 });
  });

  it('answers 409 for a stale version and for a name another manufacturer has', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await insertManufacturer(db().app, { name: 'Zanussi' });
    await write.patch(`/manufacturers/${bosch.id}`, { version: 1, note: 'a' });
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { version: 1, note: 'b' }), 409, 'conflict');
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { version: 2, name: 'zanussi' }), 409, 'duplicate_manufacturer');
  });

  it('answers 409 for an archived manufacturer, 404 for an unknown one', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await write.post(`/manufacturers/${bosch.id}/archive`, { version: 1 });
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { version: 2, name: 'X' }), 409, 'archived');
    await expectProblem(await write.patch(`/manufacturers/${MISSING}`, { version: 1, name: 'X' }), 404, 'not_found');
  });

  it('answers 400 for a missing version, an unknown key and a bad value', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { name: 'X' }), 400, 'validation_error');
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { version: 1, providers: [] }), 400, 'validation_error');
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { version: 1, name: '' }), 400, 'validation_error');
  });

  it('refuses an update that changes nothing, so the version stays put', async () => {
    const { write, read } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await expectProblem(await write.patch(`/manufacturers/${bosch.id}`, { version: 1 }), 400, 'validation_error');
    expect(await expectJson(await read.get(`/manufacturers/${bosch.id}`), 200, manufacturerDetailSchema)).toMatchObject({ version: 1 });
  });
});

describe('POST /manufacturers/{id}/archive and /restore', () => {
  it('archives and restores, keeping the version in step', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const archived = await expectJson(await write.post(`/manufacturers/${bosch.id}/archive`, { version: 1 }), 200, manufacturerSchema);
    expect(archived).toMatchObject({ version: 2, archivedAt: expect.any(String) });
    const restored = await expectJson(await write.post(`/manufacturers/${bosch.id}/restore`, { version: 2 }), 200, manufacturerSchema);
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
  });

  it('answers 409 for a stale version and for a wrong state, 404 for an unknown id', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await expectProblem(await write.post(`/manufacturers/${bosch.id}/restore`, { version: 1 }), 409, 'not_archived');
    await expectProblem(await write.post(`/manufacturers/${bosch.id}/archive`, { version: 7 }), 409, 'conflict');
    await write.post(`/manufacturers/${bosch.id}/archive`, { version: 1 });
    await expectProblem(await write.post(`/manufacturers/${bosch.id}/archive`, { version: 2 }), 409, 'archived');
    await expectProblem(await write.post(`/manufacturers/${MISSING}/archive`, { version: 1 }), 404, 'not_found');
  });

  it('answers 400 without a version', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await expectProblem(await write.post(`/manufacturers/${bosch.id}/archive`, {}), 400, 'validation_error');
  });
});

describe('PUT /manufacturers/{id}/service-providers', () => {
  async function providers() {
    const [a, b, c] = await Promise.all(
      ['Alfa servis', 'Beta servis', 'Gama servis'].map((name) => insertProvider(db().app, { name })),
    );
    return { a: a!, b: b!, c: c! };
  }

  it('saves the whole order, priorities counting from 1', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const { a, b, c } = await providers();

    const body = await expectJson(
      await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [c.id, a.id, b.id] }),
      200,
      rankedProviderListSchema,
    );
    expect(body.items.map((p) => [p.name, p.priority])).toEqual([['Gama servis', 1], ['Alfa servis', 2], ['Beta servis', 3]]);
  });

  it('reorders an existing order and can clear it', async () => {
    const { write, read } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const { a, b } = await providers();
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id, b.id] });

    const swapped = await expectJson(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [b.id, a.id] }), 200, rankedProviderListSchema);
    expect(swapped.items.map((p) => p.id)).toEqual([b.id, a.id]);

    const cleared = await expectJson(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [] }), 200, rankedProviderListSchema);
    expect(cleared.items).toEqual([]);
    expect((await expectJson(await read.get(`/manufacturers/${bosch.id}`), 200, manufacturerDetailSchema)).providers).toEqual([]);
  });

  it('keeps an already ranked provider that was archived since', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const { a, b } = await providers();
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id, b.id] });
    await archiveProvider(a.id);

    const body = await expectJson(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [b.id, a.id] }), 200, rankedProviderListSchema);
    expect(body.items.map((p) => [p.id, p.archivedAt !== null])).toEqual([[b.id, false], [a.id, true]]);
  });

  it('answers 422 for an unknown provider and for a newly added archived one, saving nothing', async () => {
    const { write, read } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const { a, b } = await providers();
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id] });
    await archiveProvider(b.id);

    await expectProblem(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id, MISSING] }), 422, 'provider_not_found');
    await expectProblem(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id, b.id] }), 422, 'provider_archived');
    const detail = await expectJson(await read.get(`/manufacturers/${bosch.id}`), 200, manufacturerDetailSchema);
    expect(detail.providers.map((p) => p.id)).toEqual([a.id]);
  });

  it('answers 409 for a repeated provider and for an archived manufacturer, 404 for an unknown one', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const { a } = await providers();
    await expectProblem(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id, a.id] }), 409, 'duplicate_provider');
    await expectProblem(await write.put(`/manufacturers/${MISSING}/service-providers`, { providerIds: [] }), 404, 'not_found');
    await write.post(`/manufacturers/${bosch.id}/archive`, { version: 1 });
    await expectProblem(await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [a.id] }), 409, 'archived');
  });

  it('answers 400 for an invalid body', async () => {
    const { write } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const path = `/manufacturers/${bosch.id}/service-providers`;
    await expectProblem(await write.put(path, {}), 400, 'validation_error');
    await expectProblem(await write.put(path, { providerIds: ['nope'] }), 400, 'validation_error');
    await expectProblem(await write.put(path, { providerIds: [], extra: 1 }), 400, 'validation_error');
  });
});

describe('roles on the manufacturer routes', () => {
  it('lets read users read but not write', async () => {
    const { read } = await setup();
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    for (const path of ['/manufacturers', `/manufacturers/${bosch.id}`]) expect((await read.get(path)).status, path).toBe(200);
    await expectProblem(await read.post('/manufacturers', { name: 'X' }), 403, 'forbidden');
    await expectProblem(await read.patch(`/manufacturers/${bosch.id}`, { version: 1, name: 'X' }), 403, 'forbidden');
    await expectProblem(await read.post(`/manufacturers/${bosch.id}/archive`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.post(`/manufacturers/${bosch.id}/restore`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [] }), 403, 'forbidden');
  });

  it('lets write and admin users write', async () => {
    const { write, admin } = await setup();
    expect((await write.post('/manufacturers', { name: 'A' })).status).toBe(201);
    expect((await admin.post('/manufacturers', { name: 'B' })).status).toBe(201);
  });

  it('changes nothing when a request is refused', async () => {
    const { read } = await setup();
    await read.post('/manufacturers', { name: 'X' });
    expect((await expectJson(await read.get('/manufacturers'), 200, manufacturerListSchema)).items).toEqual([]);
  });
});
