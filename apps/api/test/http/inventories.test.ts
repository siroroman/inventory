import { inventoryListSchema, inventoryPreviewSchema, inventorySchema } from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, inventoryItems, locations } from '../../src/db/schema/index.ts';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertInventory, insertItem, insertLocation } from '../helpers/factories.ts';
import { api, expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

async function setup() {
  const { app } = createTestApp(db().app);
  return { app, ...(await roleClients(app, db().app)) };
}

/** Centrála Praha with Patro below it and Zasedačka below that, an item in each of the first two. */
async function praha() {
  const top = await insertLocation(db().app, { name: 'Centrála Praha' });
  const patro = await insertLocation(db().app, { name: 'Patro', parentId: top.id });
  const zasedacka = await insertLocation(db().app, { name: 'Zasedačka', parentId: patro.id });
  await insertItem(db().app, { locationId: top.id });
  await insertItem(db().app, { locationId: patro.id });
  return { top, patro, zasedacka };
}

async function auditOf(id: string) {
  return db()
    .app.select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'inventory'), eq(auditLog.entityId, id)))
    .orderBy(auditLog.id);
}

describe('POST /inventories', () => {
  it('starts a run and answers with the snapshot, the people and the locations', async () => {
    const { write } = await setup();
    const { top, patro } = await praha();

    const body = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);

    expect(body).toMatchObject({
      status: 'in_progress',
      version: 1,
      location: { id: top.id, name: 'Centrála Praha' },
      path: [{ id: top.id }],
      endedAt: null,
      endedBy: null,
      note: null,
      committee: null,
      counts: { expected: 2, checked: 0, elsewhere: 0, new: 0, missing: 0 },
      activeNow: [],
    });
    expect(body.startedBy).not.toBeNull();
    expect(body.participants).toEqual([body.startedBy]);
    expect(body.locations.map((l) => [l.id, l.total, l.checked])).toEqual([
      [top.id, 1, 0],
      [patro.id, 1, 0],
    ]);
    expect(body.locations[1]!.path.map((s) => s.name)).toEqual(['Centrála Praha', 'Patro']);

    const rows = await db().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, body.id));
    expect(rows).toHaveLength(2);
    const audit = await auditOf(body.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'start',
      changes: { locationId: { from: null, to: top.id }, items: { from: null, to: 2 } },
    });
  });

  it('refuses a location that overlaps a run in progress with 409 and the run', async () => {
    const { write } = await setup();
    const { top, patro, zasedacka } = await praha();
    const first = await expectJson(await write.post('/inventories', { locationId: patro.id }), 201, inventorySchema);

    for (const locationId of [patro.id, top.id, zasedacka.id]) {
      const problem = await expectProblem(await write.post('/inventories', { locationId }), 409, 'inventory_overlap');
      expect(problem.details).toEqual({ inventoryId: first.id });
    }
    expect(await db().app.select().from(inventoryItems)).toHaveLength(1);
  });

  it('answers 422 for a location that does not exist or is archived, and 400 for a bad body', async () => {
    const { write } = await setup();
    const { top } = await praha();
    await expectProblem(await write.post('/inventories', { locationId: MISSING }), 422, 'location_not_found');
    await db().app.update(locations).set({ archivedAt: new Date() }).where(eq(locations.id, top.id));
    await expectProblem(await write.post('/inventories', { locationId: top.id }), 422, 'location_archived');
    await expectProblem(await write.post('/inventories', {}), 400, 'validation_error');
    await expectProblem(await write.post('/inventories', { locationId: 'LOC-001' }), 400, 'validation_error');
    await expectProblem(await write.post('/inventories', { locationId: MISSING, status: 'finished' }), 400, 'validation_error');
  });

  it('is for writers and admins only, and for signed-in users', async () => {
    const { app, read, admin } = await setup();
    const { top, patro } = await praha();
    await expectProblem(await read.post('/inventories', { locationId: top.id }), 403, 'forbidden');
    await expectProblem(await api(app).post('/inventories', { locationId: top.id }), 401, 'unauthenticated');
    await expectJson(await admin.post('/inventories', { locationId: patro.id }), 201, inventorySchema);
  });
});

describe('GET /inventories/preview', () => {
  it('counts what a run would check and names the run in progress it would clash with', async () => {
    const { write } = await setup();
    const { top, patro } = await praha();
    const clear = await expectJson(await write.get(`/inventories/preview?locationId=${top.id}`), 200, inventoryPreviewSchema);
    expect(clear).toEqual({ itemCount: 2, locationCount: 2, overlap: null });

    const run = await expectJson(await write.post('/inventories', { locationId: patro.id }), 201, inventorySchema);
    const busy = await expectJson(await write.get(`/inventories/preview?locationId=${top.id}`), 200, inventoryPreviewSchema);
    expect(busy.overlap).toEqual({
      id: run.id,
      location: { id: patro.id, code: patro.code, name: 'Patro' },
      startedBy: run.startedBy,
      startedAt: run.startedAt,
    });
    // Previewing writes nothing.
    expect(await auditOf(run.id)).toHaveLength(1);
  });

  it('answers 422 for an unknown or archived location, 400 for a bad id, 403 for readers, 401 for anonymous callers', async () => {
    const { app, read, write } = await setup();
    const { top } = await praha();
    await expectProblem(await write.get(`/inventories/preview?locationId=${MISSING}`), 422, 'location_not_found');
    await db().app.update(locations).set({ archivedAt: new Date() }).where(eq(locations.id, top.id));
    await expectProblem(await write.get(`/inventories/preview?locationId=${top.id}`), 422, 'location_archived');
    await expectProblem(await write.get('/inventories/preview'), 400, 'validation_error');
    await expectProblem(await write.get('/inventories/preview?locationId=nope'), 400, 'validation_error');
    await expectProblem(await read.get(`/inventories/preview?locationId=${top.id}`), 403, 'forbidden');
    await expectProblem(await api(app).get(`/inventories/preview?locationId=${top.id}`), 401, 'unauthenticated');
  });
});

describe('GET /inventories', () => {
  it('lists the runs in progress apart from the ended ones, newest first, with the total', async () => {
    const { read, write } = await setup();
    const { top } = await praha();
    const brno = await insertLocation(db().app, { name: 'Centrála Brno' });
    const ostrava = await insertLocation(db().app, { name: 'Centrála Ostrava' });
    const first = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    const second = await expectJson(await write.post('/inventories', { locationId: brno.id }), 201, inventorySchema);
    await expectJson(await write.post('/inventories', { locationId: ostrava.id }), 201, inventorySchema);
    await write.post(`/inventories/${first.id}/cancel`, { version: first.version });
    await write.post(`/inventories/${second.id}/cancel`, { version: second.version });

    const open = await expectJson(await read.get('/inventories'), 200, inventoryListSchema);
    expect(open.items.map((r) => r.location.name)).toEqual(['Centrála Ostrava']);
    expect(open).toMatchObject({ total: 1, nextCursor: null });

    const closed = await expectJson(await read.get('/inventories?state=closed'), 200, inventoryListSchema);
    expect(closed.items.map((r) => r.location.name)).toEqual(['Centrála Brno', 'Centrála Praha']);
    expect(closed.items[0]).toMatchObject({
      status: 'cancelled',
      counts: { expected: 0 },
      path: [{ name: 'Centrála Brno' }],
    });
    expect(closed.items[0]!.endedAt).not.toBeNull();
    expect(closed.items[0]!.endedBy).not.toBeNull();
    expect(closed.total).toBe(2);
  });

  it('pages and searches by the root location', async () => {
    const { read } = await setup();
    const ostrava = await insertLocation(db().app, { name: 'Pobočka Ostrava' });
    const user = (await insertInventory(db().app, { locationId: ostrava.id })).createdBy;
    for (const name of ['Sklad Brno', 'Sklad Praha', 'Dílna Praha']) {
      const location = await insertLocation(db().app, { name });
      await insertInventory(db().app, { locationId: location.id, createdBy: user });
    }
    const first = await expectJson(await read.get('/inventories?limit=2'), 200, inventoryListSchema);
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(4);
    const next = await expectJson(await read.get(`/inventories?limit=2&cursor=${first.nextCursor}`), 200, inventoryListSchema);
    expect(next.items).toHaveLength(2);
    expect(new Set([...first.items, ...next.items].map((r) => r.id)).size).toBe(4);

    const praha = await expectJson(await read.get('/inventories?q=PRAHA'), 200, inventoryListSchema);
    expect(praha.items.map((r) => r.location.name).sort()).toEqual(['Dílna Praha', 'Sklad Praha']);
    expect(praha.total).toBe(2);
  });

  it('answers 400 for bad input and 401 for an anonymous caller', async () => {
    const { app, read } = await setup();
    await expectProblem(await read.get('/inventories?state=all'), 400, 'validation_error');
    await expectProblem(await read.get('/inventories?limit=0'), 400, 'validation_error');
    await expectProblem(await read.get('/inventories?state=closed&cursor=garbage'), 400, 'invalid_cursor');
    await expectProblem(await api(app).get('/inventories'), 401, 'unauthenticated');
  });
});

describe('GET /inventories/{id}', () => {
  it('shows the run to a reader', async () => {
    const { read, write } = await setup();
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    const body = await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(body).toEqual(run);
  });

  it('answers 404 for an unknown run, 400 for a bad id and 401 for an anonymous caller', async () => {
    const { app, read } = await setup();
    await expectProblem(await read.get(`/inventories/${MISSING}`), 404, 'not_found');
    await expectProblem(await read.get('/inventories/nope'), 400, 'validation_error');
    await expectProblem(await api(app).get(`/inventories/${MISSING}`), 401, 'unauthenticated');
  });
});

describe('POST /inventories/{id}/cancel', () => {
  it('ends the run, keeps its rows and audits it', async () => {
    const { write } = await setup();
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);

    const body = await expectJson(
      await write.post(`/inventories/${run.id}/cancel`, { version: run.version }),
      200,
      inventorySchema,
    );

    expect(body).toMatchObject({ status: 'cancelled', version: 2, counts: { expected: 2 } });
    expect(body.endedAt).not.toBeNull();
    expect(body.endedBy).toEqual(body.startedBy);
    expect(await db().app.select().from(inventoryItems)).toHaveLength(2);
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'cancel']);
    expect(audit[1]!.changes).toEqual({ status: { from: 'in_progress', to: 'cancelled' } });
    // The location can be inventoried again.
    await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
  });

  it('answers 409 for a run that is already closed and for a stale version, 404 for an unknown run', async () => {
    const { write } = await setup();
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    await expectProblem(await write.post(`/inventories/${run.id}/cancel`, { version: 5 }), 409, 'conflict');
    await write.post(`/inventories/${run.id}/cancel`, { version: run.version });
    await expectProblem(await write.post(`/inventories/${run.id}/cancel`, { version: run.version }), 409, 'inventory_closed');
    await expectProblem(await write.post(`/inventories/${MISSING}/cancel`, { version: 1 }), 404, 'not_found');
  });

  it('is for writers and signed-in users, and needs a version', async () => {
    const { app, read, write } = await setup();
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    await expectProblem(await read.post(`/inventories/${run.id}/cancel`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await api(app).post(`/inventories/${run.id}/cancel`, { version: 1 }), 401, 'unauthenticated');
    await expectProblem(await write.post(`/inventories/${run.id}/cancel`, {}), 400, 'validation_error');
    expect((await expectJson(await write.get(`/inventories/${run.id}`), 200, inventorySchema)).status).toBe('in_progress');
  });
});
