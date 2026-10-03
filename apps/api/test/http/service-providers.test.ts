import {
  manufacturerDetailSchema,
  serviceProviderDetailSchema,
  serviceProviderListSchema,
  serviceProviderSchema,
} from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, manufacturers } from '../../src/db/schema/index.ts';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertManufacturer, insertProvider } from '../helpers/factories.ts';
import { expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

/** Manufacturers have no route that leaves one archived while ranked, so the test archives it directly. */
async function archiveManufacturerRow(id: string) {
  await db().app.update(manufacturers).set({ archivedAt: new Date() }).where(eq(manufacturers.id, id));
}

async function setup() {
  const { app } = createTestApp(db().app);
  return roleClients(app, db().app);
}

async function auditOf(entityType: string, id: string) {
  return db()
    .app.select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, id)))
    .orderBy(auditLog.id);
}

describe('GET /service-providers', () => {
  it('lists active providers in Czech alphabetical order', async () => {
    const { read } = await setup();
    for (const name of ['Zeta servis', 'Čech servis', 'Alfa servis', 'Elektro Svoboda']) {
      await insertProvider(db().app, { name });
    }

    const body = await expectJson(await read.get('/service-providers'), 200, serviceProviderListSchema);
    expect(body.items.map((p) => p.name)).toEqual(['Alfa servis', 'Čech servis', 'Elektro Svoboda', 'Zeta servis']);
    expect(body).toMatchObject({ total: 4, nextCursor: null });
    expect(body.items[0]?.code).toMatch(/^SUP-\d{3}$/);
  });

  it('returns the contact data with each row', async () => {
    const { read } = await setup();
    await insertProvider(db().app, {
      name: 'Servis Novák',
      contactPerson: 'Jan Novák',
      phone: '+420 111 222 333',
      email: 'novak@example.test',
      web: 'https://novak.example.test',
      note: 'Do 16:00',
    });
    const body = await expectJson(await read.get('/service-providers'), 200, serviceProviderListSchema);
    expect(body.items[0]).toMatchObject({
      contactPerson: 'Jan Novák',
      phone: '+420 111 222 333',
      email: 'novak@example.test',
      web: 'https://novak.example.test',
      note: 'Do 16:00',
      version: 1,
      archivedAt: null,
    });
  });

  it('searches by name, ignoring case and diacritics', async () => {
    const { read } = await setup();
    await insertProvider(db().app, { name: 'Čech servis' });
    await insertProvider(db().app, { name: 'Alfa servis' });
    const body = await expectJson(await read.get('/service-providers?q=CECH'), 200, serviceProviderListSchema);
    expect(body.items.map((p) => p.name)).toEqual(['Čech servis']);
    expect(body.total).toBe(1);
  });

  it('searches by code and by phone, with or without the spaces of the number', async () => {
    const { read } = await setup();
    await insertProvider(db().app, { name: 'Alfa servis', phone: '+420 601 123 456' });
    await insertProvider(db().app, { name: 'Beta servis', phone: '+420 777 234 111' });
    const names = async (q: string) =>
      (await expectJson(await read.get(`/service-providers?q=${encodeURIComponent(q)}`), 200, serviceProviderListSchema)).items.map(
        (p) => p.name,
      );

    expect(await names('sup-002')).toEqual(['Beta servis']);
    expect(await names('601 123')).toEqual(['Alfa servis']);
    expect(await names('+420601123456')).toEqual(['Alfa servis']);
    expect(await names('777')).toEqual(['Beta servis']);
    expect(await names('999')).toEqual([]);
  });

  it('lists the archived providers instead with ?archived=true', async () => {
    const { read, write } = await setup();
    const alfa = await insertProvider(db().app, { name: 'Alfa servis' });
    await insertProvider(db().app, { name: 'Beta servis' });
    await write.post(`/service-providers/${alfa.id}/archive`, { version: 1 });

    const archived = await expectJson(await read.get('/service-providers?archived=true'), 200, serviceProviderListSchema);
    expect(archived.items.map((p) => p.name)).toEqual(['Alfa servis']);
    expect(archived).toMatchObject({ total: 1 });
    expect(archived.items[0]?.archivedAt).not.toBeNull();
    expect((await expectJson(await read.get('/service-providers'), 200, serviceProviderListSchema)).items.map((p) => p.name)).toEqual([
      'Beta servis',
    ]);
    expect((await read.get('/service-providers?archived=yes')).status).toBe(400);
  });

  it('leaves archived providers out', async () => {
    const { read, write } = await setup();
    const alfa = await insertProvider(db().app, { name: 'Alfa servis' });
    await write.post(`/service-providers/${alfa.id}/archive`, { version: 1 });
    expect((await expectJson(await read.get('/service-providers'), 200, serviceProviderListSchema)).items).toEqual([]);
  });

  it('pages with limit and cursor', async () => {
    const { read } = await setup();
    for (const name of ['A', 'B', 'C']) await insertProvider(db().app, { name });

    const first = await expectJson(await read.get('/service-providers?limit=2'), 200, serviceProviderListSchema);
    expect(first.items.map((p) => p.name)).toEqual(['A', 'B']);
    expect(first.total).toBe(3);
    const second = await expectJson(
      await read.get(`/service-providers?limit=2&cursor=${first.nextCursor}`),
      200,
      serviceProviderListSchema,
    );
    expect(second.items.map((p) => p.name)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
  });

  it('treats a blank search as no search', async () => {
    const { read } = await setup();
    await insertProvider(db().app, { name: 'Alfa servis' });
    const body = await expectJson(await read.get('/service-providers?q=%20%20'), 200, serviceProviderListSchema);
    expect(body.items.map((p) => p.name)).toEqual(['Alfa servis']);
  });

  it('rejects a bad limit and cursor with 400', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/service-providers?limit=0'), 400, 'validation_error');
    await expectProblem(await read.get('/service-providers?cursor=garbage'), 400, 'invalid_cursor');
  });
});

describe('GET /service-providers/{id}', () => {
  it('returns the provider with its brands and its priority for each', async () => {
    const { read, write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const svoboda = await insertProvider(db().app, { name: 'Elektro Svoboda' });
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    const zanussi = await insertManufacturer(db().app, { name: 'Zanussi' });
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [svoboda.id, novak.id] });
    await write.put(`/manufacturers/${zanussi.id}/service-providers`, { providerIds: [novak.id] });

    const body = await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema);
    expect(body).toMatchObject({ name: 'Servis Novák', version: 1 });
    expect(body.manufacturers).toEqual([
      { id: bosch.id, name: 'Bosch', archivedAt: null, priority: 2 },
      { id: zanussi.id, name: 'Zanussi', archivedAt: null, priority: 1 },
    ]);
  });

  it('marks an archived brand instead of hiding it', async () => {
    const { read, write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [novak.id] });
    await archiveManufacturerRow(bosch.id);

    const body = await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema);
    expect(body.manufacturers).toEqual([expect.objectContaining({ id: bosch.id, archivedAt: expect.any(String) })]);
  });

  it('returns archived providers too, and 404 for an unknown one', async () => {
    const { read, write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    await write.post(`/service-providers/${novak.id}/archive`, { version: 1 });
    const body = await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema);
    expect(body.archivedAt).toEqual(expect.any(String));
    expect(body.manufacturers).toEqual([]);
    await expectProblem(await read.get(`/service-providers/${MISSING}`), 404, 'not_found');
  });

  it('answers 400 for an id that is not a UUID', async () => {
    const { read } = await setup();
    await expectProblem(await read.get('/service-providers/nope'), 400, 'validation_error');
  });
});

describe('POST /service-providers', () => {
  it('creates a provider with a generated code, trimming the text', async () => {
    const { write } = await setup();
    const body = await expectJson(
      await write.post('/service-providers', {
        name: '  Servis Novák ',
        contactPerson: 'Jan Novák',
        phone: '+420 111 222 333',
        email: ' novak@example.test ',
        web: 'https://novak.example.test',
        note: 'Do 16:00',
      }),
      201,
      serviceProviderSchema,
    );
    expect(body).toMatchObject({
      name: 'Servis Novák',
      email: 'novak@example.test',
      version: 1,
      archivedAt: null,
    });
    expect(body.code).toMatch(/^SUP-\d{3}$/);
  });

  it('needs only a name, and gives each provider its own code', async () => {
    const { write } = await setup();
    const first = await expectJson(await write.post('/service-providers', { name: 'A' }), 201, serviceProviderSchema);
    const second = await expectJson(await write.post('/service-providers', { name: 'A' }), 201, serviceProviderSchema);
    expect(first).toMatchObject({ contactPerson: null, phone: null, email: null, web: null, note: null });
    expect(second.code).not.toBe(first.code);
  });

  it('writes an audit entry with the initial fields', async () => {
    const { write } = await setup();
    const body = await expectJson(await write.post('/service-providers', { name: 'A', phone: '123' }), 201, serviceProviderSchema);
    const [entry, ...rest] = await auditOf('service_provider', body.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'create' });
    expect(entry?.changes).toMatchObject({ name: { to: 'A' }, phone: { to: '123' } });
  });

  it('answers 400 for an invalid body', async () => {
    const { write } = await setup();
    for (const body of [
      {},
      { name: '   ' },
      { name: 'x'.repeat(121) },
      { name: 'X', email: 'not-an-email' },
      { name: 'X', web: 'javascript:alert(1)' },
      { name: 'X', web: 'novak.example.test' },
      { name: 'X', phone: '' },
      { name: 'X', note: '' },
      { name: 'X', code: 'SUP-999' },
      { name: 'X', manufacturerIds: [MISSING] },
    ]) {
      await expectProblem(await write.post('/service-providers', body), 400, 'validation_error');
    }
  });
});

describe('PATCH /service-providers/{id}', () => {
  it('changes the fields sent and clears a field with null', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák', phone: '123', email: 'novak@example.test' });
    const renamed = await expectJson(
      await write.patch(`/service-providers/${novak.id}`, { version: 1, name: 'Novák servis', web: 'https://novak.example.test' }),
      200,
      serviceProviderSchema,
    );
    expect(renamed).toMatchObject({ name: 'Novák servis', phone: '123', web: 'https://novak.example.test', version: 2 });
    const cleared = await expectJson(
      await write.patch(`/service-providers/${novak.id}`, { version: 2, phone: null, email: null }),
      200,
      serviceProviderSchema,
    );
    expect(cleared).toMatchObject({ name: 'Novák servis', phone: null, email: null, version: 3 });
  });

  it('keeps the code and audits only what changed', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák', phone: '123' });
    const body = await expectJson(
      await write.patch(`/service-providers/${novak.id}`, { version: 1, name: 'Novák servis' }),
      200,
      serviceProviderSchema,
    );
    expect(body.code).toBe(novak.code);
    const entries = await auditOf('service_provider', novak.id);
    expect(entries.map((e) => e.action)).toEqual(['update']);
    expect(Object.keys(entries[0]?.changes ?? {})).toEqual(['name']);
  });

  it('answers 409 for a stale version and for an archived provider, 404 for an unknown one', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    await write.patch(`/service-providers/${novak.id}`, { version: 1, note: 'a' });
    await expectProblem(await write.patch(`/service-providers/${novak.id}`, { version: 1, note: 'b' }), 409, 'conflict');

    await write.post(`/service-providers/${novak.id}/archive`, { version: 2 });
    await expectProblem(await write.patch(`/service-providers/${novak.id}`, { version: 3, name: 'X' }), 409, 'archived');
    await expectProblem(await write.patch(`/service-providers/${MISSING}`, { version: 1, name: 'X' }), 404, 'not_found');
  });

  it('answers 400 for a missing version, an unknown key and a bad value', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const path = `/service-providers/${novak.id}`;
    await expectProblem(await write.patch(path, { name: 'X' }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, manufacturerIds: [] }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, name: '' }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, name: null }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, email: 'nope' }), 400, 'validation_error');
    await expectProblem(await write.patch(path, { version: 1, web: 'javascript:alert(1)' }), 400, 'validation_error');
  });

  it('refuses an update that changes nothing, so the version stays put', async () => {
    const { write, read } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    await expectProblem(await write.patch(`/service-providers/${novak.id}`, { version: 1 }), 400, 'validation_error');
    expect(
      await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema),
    ).toMatchObject({ version: 1 });
  });
});

describe('POST /service-providers/{id}/archive and /restore', () => {
  it('archives and restores, keeping the version in step and auditing both', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const archived = await expectJson(await write.post(`/service-providers/${novak.id}/archive`, { version: 1 }), 200, serviceProviderSchema);
    expect(archived).toMatchObject({ version: 2, archivedAt: expect.any(String) });
    const restored = await expectJson(await write.post(`/service-providers/${novak.id}/restore`, { version: 2 }), 200, serviceProviderSchema);
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
    expect((await auditOf('service_provider', novak.id)).map((e) => e.action)).toEqual(['archive', 'restore']);
  });

  it('keeps an archived provider in the contact orders it was ranked in', async () => {
    const { write, read } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const bosch = await insertManufacturer(db().app, { name: 'Bosch' });
    await write.put(`/manufacturers/${bosch.id}/service-providers`, { providerIds: [novak.id] });
    await write.post(`/service-providers/${novak.id}/archive`, { version: 1 });

    const detail = await expectJson(await read.get(`/manufacturers/${bosch.id}`), 200, manufacturerDetailSchema);
    expect(detail.providers).toEqual([expect.objectContaining({ id: novak.id, archivedAt: expect.any(String), priority: 1 })]);
  });

  it('answers 409 for a stale version and for a wrong state, 404 for an unknown id', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    await expectProblem(await write.post(`/service-providers/${novak.id}/restore`, { version: 1 }), 409, 'not_archived');
    await expectProblem(await write.post(`/service-providers/${novak.id}/archive`, { version: 7 }), 409, 'conflict');
    await write.post(`/service-providers/${novak.id}/archive`, { version: 1 });
    await expectProblem(await write.post(`/service-providers/${novak.id}/archive`, { version: 2 }), 409, 'archived');
    await expectProblem(await write.post(`/service-providers/${MISSING}/archive`, { version: 1 }), 404, 'not_found');
  });

  it('answers 400 without a version', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    await expectProblem(await write.post(`/service-providers/${novak.id}/archive`, {}), 400, 'validation_error');
  });
});

describe('PUT /service-providers/{id}/manufacturers', () => {
  async function brands() {
    const [a, b, c] = await Promise.all(['Alfa', 'Beta', 'Gama'].map((name) => insertManufacturer(db().app, { name })));
    return { a: a!, b: b!, c: c! };
  }

  it('saves the whole set of brands and returns the provider with them, listed by name', async () => {
    const { write, read } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a, b, c } = await brands();

    const body = await expectJson(
      await write.put(`/service-providers/${novak.id}/manufacturers`, { version: 1, manufacturerIds: [c.id, a.id, b.id] }),
      200,
      serviceProviderDetailSchema,
    );
    expect(body.manufacturers.map((m) => m.name)).toEqual(['Alfa', 'Beta', 'Gama']);
    const detail = await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema);
    expect(detail.manufacturers.map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });

  it('bumps the version when the brands change and returns it for the next save', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a, b } = await brands();
    const path = `/service-providers/${novak.id}/manufacturers`;

    const first = await expectJson(await write.put(path, { version: 1, manufacturerIds: [a.id] }), 200, serviceProviderDetailSchema);
    expect(first.version).toBe(2);
    const same = await expectJson(await write.put(path, { version: 2, manufacturerIds: [a.id] }), 200, serviceProviderDetailSchema);
    expect(same.version).toBe(2);
    const second = await expectJson(await write.put(path, { version: 2, manufacturerIds: [a.id, b.id] }), 200, serviceProviderDetailSchema);
    expect(second.version).toBe(3);
  });

  it('follows an edit of the provider with the brands, as the form does', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a } = await brands();
    const edited = await expectJson(await write.patch(`/service-providers/${novak.id}`, { version: 1, phone: '123' }), 200, serviceProviderSchema);
    const saved = await expectJson(
      await write.put(`/service-providers/${novak.id}/manufacturers`, { version: edited.version, manufacturerIds: [a.id] }),
      200,
      serviceProviderDetailSchema,
    );
    expect(saved).toMatchObject({ phone: '123', version: 3 });
  });

  it('answers 409 for a stale version, whoever changed the provider, and saves nothing', async () => {
    const { write, read } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a, b } = await brands();
    const path = `/service-providers/${novak.id}/manufacturers`;
    await write.put(path, { version: 1, manufacturerIds: [a.id] });

    await expectProblem(await write.put(path, { version: 1, manufacturerIds: [b.id] }), 409, 'conflict');
    await write.patch(`/service-providers/${novak.id}`, { version: 2, note: 'x' });
    await expectProblem(await write.put(path, { version: 2, manufacturerIds: [b.id] }), 409, 'conflict');
    const detail = await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema);
    expect(detail.manufacturers.map((m) => m.id)).toEqual([a.id]);
  });

  it('ranks the provider last for a new brand and closes the gap for a dropped one', async () => {
    const { write, read } = await setup();
    const first = await insertProvider(db().app, { name: 'První' });
    const second = await insertProvider(db().app, { name: 'Druhý' });
    const third = await insertProvider(db().app, { name: 'Třetí' });
    const { a } = await brands();
    await write.put(`/manufacturers/${a.id}/service-providers`, { providerIds: [first.id, third.id] });

    const added = await expectJson(
      await write.put(`/service-providers/${second.id}/manufacturers`, { version: 1, manufacturerIds: [a.id] }),
      200,
      serviceProviderDetailSchema,
    );
    expect(added.manufacturers).toEqual([{ id: a.id, name: 'Alfa', archivedAt: null, priority: 3 }]);

    await write.put(`/service-providers/${first.id}/manufacturers`, { version: 1, manufacturerIds: [] });
    const detail = await expectJson(await read.get(`/manufacturers/${a.id}`), 200, manufacturerDetailSchema);
    expect(detail.providers.map((p) => [p.id, p.priority])).toEqual([[third.id, 1], [second.id, 2]]);
  });

  it('audits the provider and each affected manufacturer, and nothing for an unchanged set', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a, b } = await brands();
    const path = `/service-providers/${novak.id}/manufacturers`;
    await write.put(path, { version: 1, manufacturerIds: [a.id] });
    await write.put(path, { version: 2, manufacturerIds: [a.id] });
    await write.put(path, { version: 2, manufacturerIds: [b.id] });

    expect((await auditOf('service_provider', novak.id)).map((e) => e.changes)).toEqual([
      { manufacturers: { from: [], to: [a.id] } },
      { manufacturers: { from: [a.id], to: [b.id] } },
    ]);
    expect((await auditOf('manufacturer', a.id)).map((e) => e.changes)).toEqual([
      { providers: { from: [], to: [novak.id] } },
      { providers: { from: [novak.id], to: [] } },
    ]);
    expect((await auditOf('manufacturer', b.id)).map((e) => e.changes)).toEqual([
      { providers: { from: [], to: [novak.id] } },
    ]);
  });

  it('lets a provider keep a brand that was archived since, and leave it', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a, b } = await brands();
    const path = `/service-providers/${novak.id}/manufacturers`;
    await write.put(path, { version: 1, manufacturerIds: [a.id, b.id] });
    await archiveManufacturerRow(a.id);

    const kept = await expectJson(await write.put(path, { version: 2, manufacturerIds: [a.id, b.id] }), 200, serviceProviderDetailSchema);
    expect(kept.manufacturers.map((m) => [m.id, m.archivedAt !== null])).toEqual([[a.id, true], [b.id, false]]);
    const left = await expectJson(await write.put(path, { version: 2, manufacturerIds: [b.id] }), 200, serviceProviderDetailSchema);
    expect(left.manufacturers.map((m) => m.id)).toEqual([b.id]);
  });

  it('answers 422 for an unknown brand and for a newly added archived one, saving nothing', async () => {
    const { write, read } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a, b } = await brands();
    const path = `/service-providers/${novak.id}/manufacturers`;
    await write.put(path, { version: 1, manufacturerIds: [a.id] });
    await archiveManufacturerRow(b.id);

    await expectProblem(await write.put(path, { version: 2, manufacturerIds: [a.id, MISSING] }), 422, 'manufacturer_not_found');
    await expectProblem(await write.put(path, { version: 2, manufacturerIds: [a.id, b.id] }), 422, 'manufacturer_archived');
    const detail = await expectJson(await read.get(`/service-providers/${novak.id}`), 200, serviceProviderDetailSchema);
    expect(detail).toMatchObject({ version: 2 });
    expect(detail.manufacturers.map((m) => m.id)).toEqual([a.id]);
  });

  it('answers 409 for a repeated brand and for an archived provider, 404 for an unknown one', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const { a } = await brands();
    const path = `/service-providers/${novak.id}/manufacturers`;
    await expectProblem(await write.put(path, { version: 1, manufacturerIds: [a.id, a.id] }), 409, 'duplicate_manufacturer');
    await expectProblem(await write.put(`/service-providers/${MISSING}/manufacturers`, { version: 1, manufacturerIds: [] }), 404, 'not_found');
    await write.post(`/service-providers/${novak.id}/archive`, { version: 1 });
    await expectProblem(await write.put(path, { version: 2, manufacturerIds: [a.id] }), 409, 'archived');
  });

  it('answers 400 for an invalid body', async () => {
    const { write } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    const path = `/service-providers/${novak.id}/manufacturers`;
    await expectProblem(await write.put(path, {}), 400, 'validation_error');
    await expectProblem(await write.put(path, { manufacturerIds: [] }), 400, 'validation_error');
    await expectProblem(await write.put(path, { version: 1 }), 400, 'validation_error');
    await expectProblem(await write.put(path, { version: 1, manufacturerIds: ['nope'] }), 400, 'validation_error');
    await expectProblem(await write.put(path, { version: 1, manufacturerIds: [], extra: 1 }), 400, 'validation_error');
    await expectProblem(
      await write.put(path, { version: 1, manufacturerIds: Array.from({ length: 101 }, () => MISSING) }),
      400,
      'validation_error',
    );
  });
});

describe('roles on the service provider routes', () => {
  it('lets read users read but not write', async () => {
    const { read } = await setup();
    const novak = await insertProvider(db().app, { name: 'Servis Novák' });
    for (const path of ['/service-providers', `/service-providers/${novak.id}`]) {
      expect((await read.get(path)).status, path).toBe(200);
    }
    await expectProblem(await read.post('/service-providers', { name: 'X' }), 403, 'forbidden');
    await expectProblem(await read.patch(`/service-providers/${novak.id}`, { version: 1, name: 'X' }), 403, 'forbidden');
    await expectProblem(await read.post(`/service-providers/${novak.id}/archive`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.post(`/service-providers/${novak.id}/restore`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.put(`/service-providers/${novak.id}/manufacturers`, { version: 1, manufacturerIds: [] }), 403, 'forbidden');
  });

  it('lets write and admin users write', async () => {
    const { write, admin } = await setup();
    expect((await write.post('/service-providers', { name: 'A' })).status).toBe(201);
    expect((await admin.post('/service-providers', { name: 'B' })).status).toBe(201);
  });

  it('changes nothing when a request is refused', async () => {
    const { read } = await setup();
    await read.post('/service-providers', { name: 'X' });
    expect((await expectJson(await read.get('/service-providers'), 200, serviceProviderListSchema)).items).toEqual([]);
  });
});
