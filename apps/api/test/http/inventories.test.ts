import {
  inventoryListSchema,
  inventoryPreviewSchema,
  inventoryRowSchema,
  inventoryRowsSchema,
  inventorySchema,
  scanResultSchema,
} from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, inventoryItems, items, locations } from '../../src/db/schema/index.ts';
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

describe('POST /inventories/{id}/finish', () => {
  it('ends the run, counts what was flagged as missing, leaves the rest not checked and audits it', async () => {
    const { read, write } = await setup();
    const { run, mixer, ladder } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/check`);
    await write.post(`/inventories/${run.id}/items/${ladder.id}/mark-missing`);

    const body = await expectJson(
      await write.post(`/inventories/${run.id}/finish`, { version: run.version }),
      200,
      inventorySchema,
    );

    expect(body).toMatchObject({ status: 'finished', version: 2, counts: { expected: 5, checked: 1, missing: 1 } });
    expect(body.endedAt).not.toBeNull();
    expect(body.endedBy).toEqual(body.startedBy);
    const outcomes = await db().app.select({ outcome: inventoryItems.outcome }).from(inventoryItems);
    expect(outcomes.filter((r) => r.outcome === 'missing')).toHaveLength(1);
    expect(outcomes.filter((r) => r.outcome === null)).toHaveLength(4);
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'check', 'mark_missing', 'finish']);
    expect(audit[3]!.changes).toEqual({
      status: { from: 'in_progress', to: 'finished' },
      missing: { from: null, to: 1 },
    });
    // It shows among the ended runs, and nothing can be checked in it any more.
    const closed = await expectJson(await read.get('/inventories?state=closed'), 200, inventoryListSchema);
    expect(closed.items).toMatchObject([{ id: run.id, status: 'finished', counts: { missing: 1 } }]);
    await expectProblem(await write.post(`/inventories/${run.id}/items/${mixer.id}/uncheck`), 409, 'inventory_closed');
    await expectProblem(await write.post(`/inventories/${run.id}/items/${ladder.id}/unmark-missing`), 409, 'inventory_closed');
    // The flagged row still shows as missing in the run's rows.
    const rows = await expectJson(await read.get(`/inventories/${run.id}/items`), 200, inventoryRowsSchema);
    expect(rows.items.filter((r) => r.missing).map((r) => r.id)).toEqual([ladder.id]);
  });

  it('answers 409 for a closed run and a stale version, 404 for an unknown run', async () => {
    const { write } = await setup();
    const { run } = await startedRun(write);
    await expectProblem(await write.post(`/inventories/${run.id}/finish`, { version: 5 }), 409, 'conflict');
    await write.post(`/inventories/${run.id}/finish`, { version: run.version });
    await expectProblem(await write.post(`/inventories/${run.id}/finish`, { version: run.version }), 409, 'inventory_closed');
    await expectProblem(await write.post(`/inventories/${run.id}/cancel`, { version: 2 }), 409, 'inventory_closed');
    await expectProblem(await write.post(`/inventories/${MISSING}/finish`, { version: 1 }), 404, 'not_found');
  });

  it('is for writers and signed-in users, and needs a version', async () => {
    const { app, read, write } = await setup();
    const { run } = await startedRun(write);
    await expectProblem(await read.post(`/inventories/${run.id}/finish`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await api(app).post(`/inventories/${run.id}/finish`, { version: 1 }), 401, 'unauthenticated');
    await expectProblem(await write.post(`/inventories/${run.id}/finish`, {}), 400, 'validation_error');
    expect((await expectJson(await write.get(`/inventories/${run.id}`), 200, inventorySchema)).status).toBe('in_progress');
  });
});

describe('POST /inventories/{id}/reopen', () => {
  it('takes a finished run back, keeps checks and flags and audits it', async () => {
    const { read, write } = await setup();
    const { run, mixer, ladder } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/check`);
    await write.post(`/inventories/${run.id}/items/${ladder.id}/mark-missing`);
    const finished = await expectJson(
      await write.post(`/inventories/${run.id}/finish`, { version: run.version }),
      200,
      inventorySchema,
    );
    expect(finished.counts).toMatchObject({ checked: 1, missing: 1 });

    const body = await expectJson(
      await write.post(`/inventories/${run.id}/reopen`, { version: finished.version }),
      200,
      inventorySchema,
    );

    expect(body).toMatchObject({
      status: 'in_progress',
      version: finished.version + 1,
      endedAt: null,
      endedBy: null,
      counts: { expected: 5, checked: 1, missing: 1 },
    });
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'check', 'mark_missing', 'finish', 'reopen']);
    expect(audit[4]!.changes).toEqual({ status: { from: 'finished', to: 'in_progress' } });
    // It is among the runs in progress again, and takes ticks.
    const open = await expectJson(await read.get('/inventories?state=open'), 200, inventoryListSchema);
    expect(open.items.map((r) => r.id)).toEqual([run.id]);
    const closed = await expectJson(await read.get('/inventories?state=closed'), 200, inventoryListSchema);
    expect(closed.items).toEqual([]);
    const rows = await expectJson(await read.get(`/inventories/${run.id}/items`), 200, inventoryRowsSchema);
    const another = rows.items.find((r) => !r.checkedAt && !r.missing)!;
    expect((await write.post(`/inventories/${run.id}/items/${another.id}/check`)).status).toBe(200);
    // The flag set by hand survived, and a check takes it back.
    expect(rows.items.find((r) => r.id === ladder.id)).toMatchObject({ missing: true });
    expect((await write.post(`/inventories/${run.id}/items/${ladder.id}/check`)).status).toBe(200);
  });

  it('answers 409 inventory_overlap while another run is in progress there', async () => {
    const { write } = await setup();
    const { top, patro } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    const finished = await expectJson(
      await write.post(`/inventories/${run.id}/finish`, { version: run.version }),
      200,
      inventorySchema,
    );
    const other = await expectJson(await write.post('/inventories', { locationId: patro.id }), 201, inventorySchema);

    const problem = await expectProblem(
      await write.post(`/inventories/${run.id}/reopen`, { version: finished.version }),
      409,
      'inventory_overlap',
    );
    expect(problem.details).toEqual({ inventoryId: other.id });
  });

  it('takes a cancelled run back into progress too', async () => {
    const { write, read } = await setup();
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    const cancelled = await expectJson(
      await write.post(`/inventories/${run.id}/cancel`, { version: run.version }),
      200,
      inventorySchema,
    );

    const body = await expectJson(
      await write.post(`/inventories/${run.id}/reopen`, { version: cancelled.version }),
      200,
      inventorySchema,
    );

    expect(body).toMatchObject({ status: 'in_progress', version: cancelled.version + 1, endedAt: null, endedBy: null });
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'cancel', 'reopen']);
    expect(audit[2]!.changes).toEqual({ status: { from: 'cancelled', to: 'in_progress' } });
    const open = await expectJson(await read.get('/inventories?state=open'), 200, inventoryListSchema);
    expect(open.items.map((r) => r.id)).toEqual([run.id]);
  });

  it('answers 409 for a run in progress, an archived one and a stale version', async () => {
    const { write } = await setup();
    const { top } = await praha();
    const open = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    await expectProblem(await write.post(`/inventories/${open.id}/reopen`, { version: open.version }), 409, 'inventory_in_progress');

    await write.post(`/inventories/${open.id}/cancel`, { version: open.version });

    const second = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    const finished = await expectJson(
      await write.post(`/inventories/${second.id}/finish`, { version: second.version }),
      200,
      inventorySchema,
    );
    await expectProblem(await write.post(`/inventories/${second.id}/reopen`, { version: 99 }), 409, 'conflict');
    const archived = await expectJson(
      await write.post(`/inventories/${second.id}/archive`, { version: finished.version }),
      200,
      inventorySchema,
    );
    await expectProblem(await write.post(`/inventories/${second.id}/reopen`, { version: archived.version }), 409, 'archived');
    await expectProblem(await write.post(`/inventories/${MISSING}/reopen`, { version: 1 }), 404, 'not_found');
  });

  it('is for writers and signed-in users, and needs a version', async () => {
    const { app, read, write } = await setup();
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    await write.post(`/inventories/${run.id}/finish`, { version: run.version });
    await expectProblem(await read.post(`/inventories/${run.id}/reopen`, { version: 2 }), 403, 'forbidden');
    await expectProblem(await api(app).post(`/inventories/${run.id}/reopen`, { version: 2 }), 401, 'unauthenticated');
    await expectProblem(await write.post(`/inventories/${run.id}/reopen`, {}), 400, 'validation_error');
  });
});

describe('POST /inventories/{id}/archive and /restore', () => {
  async function finishedRun(write: Awaited<ReturnType<typeof setup>>['write']) {
    const { top } = await praha();
    const run = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    return expectJson(await write.post(`/inventories/${run.id}/finish`, { version: run.version }), 200, inventorySchema);
  }

  it('archives an ended run out of the list, restores it and audits both', async () => {
    const { read, write } = await setup();
    const run = await finishedRun(write);

    const archived = await expectJson(
      await write.post(`/inventories/${run.id}/archive`, { version: run.version }),
      200,
      inventorySchema,
    );

    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(run.version + 1);
    expect(archived.status).toBe('finished');
    const active = await expectJson(await read.get('/inventories?state=closed'), 200, inventoryListSchema);
    expect(active).toMatchObject({ items: [], total: 0 });
    const inArchive = await expectJson(await read.get('/inventories?state=closed&archived=true'), 200, inventoryListSchema);
    expect(inArchive).toMatchObject({ items: [{ id: run.id }], total: 1 });
    expect(inArchive.items[0]!.archivedAt).not.toBeNull();
    // An archived run is still there to read and to restore.
    expect((await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema)).archivedAt).not.toBeNull();

    const restored = await expectJson(
      await write.post(`/inventories/${run.id}/restore`, { version: archived.version }),
      200,
      inventorySchema,
    );
    expect(restored.archivedAt).toBeNull();
    const again = await expectJson(await read.get('/inventories?state=closed'), 200, inventoryListSchema);
    expect(again.items.map((r) => r.id)).toEqual([run.id]);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'finish', 'archive', 'restore']);
  });

  it('refuses a run in progress, a second archive, a restore of an active run and a stale version', async () => {
    const { write } = await setup();
    const { top } = await praha();
    const open = await expectJson(await write.post('/inventories', { locationId: top.id }), 201, inventorySchema);
    await expectProblem(await write.post(`/inventories/${open.id}/archive`, { version: open.version }), 409, 'inventory_in_progress');

    const run = await finishedRun(write);
    await expectProblem(await write.post(`/inventories/${run.id}/restore`, { version: run.version }), 409, 'not_archived');
    await expectProblem(await write.post(`/inventories/${run.id}/archive`, { version: 99 }), 409, 'conflict');
    await write.post(`/inventories/${run.id}/archive`, { version: run.version });
    await expectProblem(await write.post(`/inventories/${run.id}/archive`, { version: run.version + 1 }), 409, 'archived');
    await expectProblem(await write.post(`/inventories/${MISSING}/archive`, { version: 1 }), 404, 'not_found');
  });

  it('is for writers and signed-in users, and needs a version', async () => {
    const { app, read, write } = await setup();
    const run = await finishedRun(write);
    for (const action of ['archive', 'restore']) {
      await expectProblem(await read.post(`/inventories/${run.id}/${action}`, { version: 1 }), 403, 'forbidden');
      await expectProblem(await api(app).post(`/inventories/${run.id}/${action}`, { version: 1 }), 401, 'unauthenticated');
      await expectProblem(await write.post(`/inventories/${run.id}/${action}`, {}), 400, 'validation_error');
    }
    await expectProblem(await read.get('/inventories?archived=false'), 400, 'validation_error');
  });
});

/** A run on Centrála Praha with Mixér and Žebřík there and Čepice in Patro. */
async function startedRun(client: Awaited<ReturnType<typeof setup>>['write']) {
  const { top, patro } = await praha();
  const mixer = await insertItem(db().app, { name: 'Mixér', locationId: top.id });
  const ladder = await insertItem(db().app, { name: 'Žebřík', locationId: top.id });
  const cap = await insertItem(db().app, { name: 'Čepice', locationId: patro.id });
  const run = await expectJson(await client.post('/inventories', { locationId: top.id }), 201, inventorySchema);
  return { run, top, patro, mixer, ladder, cap };
}

describe('GET /inventories/{id}/items', () => {
  it('lists the rows by item name, and those of one location', async () => {
    const { read, write } = await setup();
    const { run, patro, cap } = await startedRun(write);

    const all = await expectJson(await read.get(`/inventories/${run.id}/items`), 200, inventoryRowsSchema);
    // `praha()` adds two items named Konvektomat. Czech order puts Čepice after C, not after Z.
    expect(all.items.map((r) => r.name)).toEqual(['Čepice', 'Konvektomat', 'Konvektomat', 'Mixér', 'Žebřík']);
    expect(all.items[0]).toMatchObject({
      id: cap.id,
      code: cap.code,
      kind: 'expected',
      locationId: patro.id,
      checkedAt: null,
      checkedBy: null,
      method: null,
      registeredPath: [],
      moved: false,
    });

    const inPatro = await expectJson(
      await read.get(`/inventories/${run.id}/items?locationId=${patro.id}`),
      200,
      inventoryRowsSchema,
    );
    expect(inPatro.items.map((r) => r.name)).toEqual(['Čepice', 'Konvektomat']);
  });

  it('hides archived items and shows who checked a row', async () => {
    const { read, write } = await setup();
    const { run, mixer, ladder } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/check`);
    await db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, ladder.id));

    const body = await expectJson(await read.get(`/inventories/${run.id}/items`), 200, inventoryRowsSchema);
    expect(body.items.map((r) => r.name)).not.toContain('Žebřík');
    const row = body.items.find((r) => r.id === mixer.id)!;
    expect(row.checkedBy).not.toBeNull();
    expect(row).toMatchObject({ method: 'manual' });
    expect(row.checkedAt).not.toBeNull();
  });

  it('answers 404 for an unknown run, 400 for bad ids and 401 for an anonymous caller', async () => {
    const { app, read } = await setup();
    await expectProblem(await read.get(`/inventories/${MISSING}/items`), 404, 'not_found');
    await expectProblem(await read.get('/inventories/nope/items'), 400, 'validation_error');
    await expectProblem(await read.get(`/inventories/${MISSING}/items?locationId=nope`), 400, 'validation_error');
    await expectProblem(await api(app).get(`/inventories/${MISSING}/items`), 401, 'unauthenticated');
  });
});

describe('POST /inventories/{id}/items/{itemId}/check', () => {
  it('ticks the row, shows it in the list and the counts, and audits it', async () => {
    const { read, write } = await setup();
    const { run, mixer } = await startedRun(write);

    const row = await expectJson(await write.post(`/inventories/${run.id}/items/${mixer.id}/check`), 200, inventoryRowSchema);

    expect(row).toMatchObject({ id: mixer.id, name: 'Mixér', method: 'manual', checkedBy: run.startedBy });
    expect(row.checkedAt).not.toBeNull();
    const detail = await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts.checked).toBe(1);
    expect(detail.version).toBe(run.version);
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'check']);
    expect(audit[1]!.changes).toEqual({ itemId: { from: null, to: mixer.id }, method: { from: null, to: 'manual' } });
  });

  it('leaves a row that is already checked to the person who checked it first', async () => {
    const { write, admin } = await setup();
    const { run, mixer } = await startedRun(write);
    const first = await expectJson(await write.post(`/inventories/${run.id}/items/${mixer.id}/check`), 200, inventoryRowSchema);
    const second = await expectJson(await admin.post(`/inventories/${run.id}/items/${mixer.id}/check`), 200, inventoryRowSchema);
    expect(second).toEqual(first);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'check']);
  });

  it('answers 422 for an item the run does not have, 404 for an unknown run', async () => {
    const { write } = await setup();
    const { run } = await startedRun(write);
    const outside = await insertItem(db().app, { name: 'Jinde' });
    await expectProblem(await write.post(`/inventories/${run.id}/items/${outside.id}/check`), 422, 'item_not_in_inventory');
    await expectProblem(await write.post(`/inventories/${run.id}/items/${MISSING}/check`), 422, 'item_not_in_inventory');
    await expectProblem(await write.post(`/inventories/${MISSING}/items/${outside.id}/check`), 404, 'not_found');
  });

  it('answers 409 for a run that is closed and for an item archived since the start', async () => {
    const { write } = await setup();
    const { run, mixer, ladder } = await startedRun(write);
    await db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, ladder.id));
    await expectProblem(await write.post(`/inventories/${run.id}/items/${ladder.id}/check`), 409, 'archived');

    await write.post(`/inventories/${run.id}/cancel`, { version: run.version });
    await expectProblem(await write.post(`/inventories/${run.id}/items/${mixer.id}/check`), 409, 'inventory_closed');
    const rows = await db().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, run.id));
    expect(rows.every((row) => row.checkedAt === null)).toBe(true);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'cancel']);
  });

  it('is for writers and signed-in users, and needs valid ids', async () => {
    const { app, read, admin, write } = await setup();
    const { run, mixer, cap } = await startedRun(write);
    await expectProblem(await read.post(`/inventories/${run.id}/items/${mixer.id}/check`), 403, 'forbidden');
    await expectProblem(await api(app).post(`/inventories/${run.id}/items/${mixer.id}/check`), 401, 'unauthenticated');
    await expectProblem(await write.post(`/inventories/${run.id}/items/nope/check`), 400, 'validation_error');
    await expectJson(await admin.post(`/inventories/${run.id}/items/${cap.id}/check`), 200, inventoryRowSchema);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'check']);
  });
});

describe('POST /inventories/{id}/items/{itemId}/uncheck', () => {
  it('clears the tick, whoever made it, and audits it', async () => {
    const { write, admin } = await setup();
    const { run, mixer } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/check`);

    const row = await expectJson(await admin.post(`/inventories/${run.id}/items/${mixer.id}/uncheck`), 200, inventoryRowSchema);

    expect(row).toMatchObject({ id: mixer.id, checkedAt: null, checkedBy: null, method: null });
    const detail = await expectJson(await write.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts.checked).toBe(0);
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'check', 'uncheck']);
    expect(audit[2]!.changes).toEqual({ itemId: { from: mixer.id, to: null } });
  });

  it('changes nothing for a row that is not checked', async () => {
    const { write } = await setup();
    const { run, mixer } = await startedRun(write);
    await expectJson(await write.post(`/inventories/${run.id}/items/${mixer.id}/uncheck`), 200, inventoryRowSchema);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start']);
  });

  it('answers 404, 422 and 409 like a check, and refuses readers and anonymous callers', async () => {
    const { app, read, write } = await setup();
    const { run, mixer } = await startedRun(write);
    const outside = await insertItem(db().app, { name: 'Jinde' });
    await write.post(`/inventories/${run.id}/items/${mixer.id}/check`);

    await expectProblem(await write.post(`/inventories/${run.id}/items/${outside.id}/uncheck`), 422, 'item_not_in_inventory');
    await expectProblem(await write.post(`/inventories/${MISSING}/items/${mixer.id}/uncheck`), 404, 'not_found');
    await expectProblem(await read.post(`/inventories/${run.id}/items/${mixer.id}/uncheck`), 403, 'forbidden');
    await expectProblem(await api(app).post(`/inventories/${run.id}/items/${mixer.id}/uncheck`), 401, 'unauthenticated');
    await expectProblem(await write.post(`/inventories/${run.id}/items/nope/uncheck`), 400, 'validation_error');

    await write.post(`/inventories/${run.id}/cancel`, { version: run.version });
    await expectProblem(await write.post(`/inventories/${run.id}/items/${mixer.id}/uncheck`), 409, 'inventory_closed');
    const detail = await expectJson(await write.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts.checked).toBe(1);
  });
});

describe('POST /inventories/{id}/items/{itemId}/mark-missing and /unmark-missing', () => {
  it('flags an unchecked item, shows it in the rows and the counts, and audits it', async () => {
    const { read, write } = await setup();
    const { run, mixer } = await startedRun(write);

    const row = await expectJson(
      await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`),
      200,
      inventoryRowSchema,
    );

    expect(row).toMatchObject({ id: mixer.id, name: 'Mixér', missing: true, checkedAt: null, checkedBy: null });
    const detail = await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts).toMatchObject({ expected: 5, checked: 0, missing: 1 });
    expect(detail.locations.reduce((sum, l) => sum + l.missing, 0)).toBe(1);
    expect(detail.version).toBe(run.version);
    const rows = await expectJson(await read.get(`/inventories/${run.id}/items`), 200, inventoryRowsSchema);
    expect(rows.items.filter((r) => r.missing).map((r) => r.id)).toEqual([mixer.id]);
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'mark_missing']);
    expect(audit[1]!.changes).toEqual({ itemId: { from: null, to: mixer.id } });
  });

  it('takes the flag back, whoever set it, and audits it', async () => {
    const { write, admin } = await setup();
    const { run, mixer } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`);

    const row = await expectJson(
      await admin.post(`/inventories/${run.id}/items/${mixer.id}/unmark-missing`),
      200,
      inventoryRowSchema,
    );

    expect(row).toMatchObject({ id: mixer.id, missing: false, checkedAt: null });
    const detail = await expectJson(await write.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts.missing).toBe(0);
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'mark_missing', 'unmark_missing']);
    expect(audit[2]!.changes).toEqual({ itemId: { from: mixer.id, to: null } });
  });

  it('is taken back by a check, and is no error for a row that is flagged or not flagged already', async () => {
    const { write } = await setup();
    const { run, mixer, ladder } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`);
    await write.post(`/inventories/${run.id}/items/${ladder.id}/unmark-missing`);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'mark_missing']);

    const checked = await expectJson(await write.post(`/inventories/${run.id}/items/${mixer.id}/check`), 200, inventoryRowSchema);
    expect(checked).toMatchObject({ missing: false });
    const detail = await expectJson(await write.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts).toMatchObject({ checked: 1, missing: 0 });
    // A row somebody checked is not flagged afterwards: found beats missing.
    const again = await expectJson(await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`), 200, inventoryRowSchema);
    expect(again).toMatchObject({ missing: false });
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'mark_missing', 'check']);
  });

  it('is cleared by a scan of the label', async () => {
    const { write } = await setup();
    const { run, mixer } = await startedRun(write);
    await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`);

    const result = await expectJson(
      await write.post(`/inventories/${run.id}/scans`, { code: mixer.code }),
      200,
      scanResultSchema,
    );

    expect(result).toMatchObject({ outcome: 'found', row: { id: mixer.id, missing: false } });
  });

  it('answers 422 for an item that is not on the list, 404 for an unknown run, 409 for an archived item and a closed run', async () => {
    const { write } = await setup();
    const { run, mixer, ladder } = await startedRun(write);
    const outside = await insertItem(db().app, { name: 'Jinde' });
    await expectProblem(await write.post(`/inventories/${run.id}/items/${outside.id}/mark-missing`), 422, 'item_not_in_inventory');
    await expectProblem(await write.post(`/inventories/${run.id}/items/${MISSING}/unmark-missing`), 422, 'item_not_in_inventory');
    await expectProblem(await write.post(`/inventories/${MISSING}/items/${mixer.id}/mark-missing`), 404, 'not_found');
    // An item found elsewhere is not on the list, so it cannot be missing.
    await write.post(`/inventories/${run.id}/scans`, { code: outside.code });
    await expectProblem(await write.post(`/inventories/${run.id}/items/${outside.id}/mark-missing`), 422, 'item_not_in_inventory');

    await db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, ladder.id));
    await expectProblem(await write.post(`/inventories/${run.id}/items/${ladder.id}/mark-missing`), 409, 'archived');

    await write.post(`/inventories/${run.id}/cancel`, { version: run.version });
    await expectProblem(await write.post(`/inventories/${run.id}/items/${mixer.id}/mark-missing`), 409, 'inventory_closed');
    const rows = await db().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, run.id));
    expect(rows.every((row) => row.outcome === null)).toBe(true);
  });

  it('is for writers and signed-in users, and needs valid ids', async () => {
    const { app, read, admin, write } = await setup();
    const { run, mixer, cap } = await startedRun(write);
    for (const action of ['mark-missing', 'unmark-missing']) {
      await expectProblem(await read.post(`/inventories/${run.id}/items/${mixer.id}/${action}`), 403, 'forbidden');
      await expectProblem(await api(app).post(`/inventories/${run.id}/items/${mixer.id}/${action}`), 401, 'unauthenticated');
      await expectProblem(await write.post(`/inventories/${run.id}/items/nope/${action}`), 400, 'validation_error');
    }
    await expectJson(await admin.post(`/inventories/${run.id}/items/${cap.id}/mark-missing`), 200, inventoryRowSchema);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'mark_missing']);
  });
});

describe('POST /inventories/{id}/scans', () => {
  const scan = (client: Awaited<ReturnType<typeof setup>>['write'], runId: string, body: unknown) =>
    client.post(`/inventories/${runId}/scans`, body);

  it('checks a listed item by its code, case ignored, and audits it as a scan', async () => {
    const { read, write } = await setup();
    const { run, mixer } = await startedRun(write);

    const body = await expectJson(await scan(write, run.id, { code: mixer.code.toLowerCase() }), 200, scanResultSchema);

    expect(body).toMatchObject({
      outcome: 'found',
      misplaced: false,
      wasMissing: false,
      item: { id: mixer.id, code: mixer.code, name: 'Mixér', path: [{ name: 'Centrála Praha' }] },
      row: { id: mixer.id, kind: 'expected', method: 'scan', checkedBy: run.startedBy },
    });
    const detail = await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail).toMatchObject({ version: run.version, counts: { checked: 1 } });
    const audit = await auditOf(run.id);
    expect(audit.map((e) => e.action)).toEqual(['start', 'check']);
    expect(audit[1]!.changes).toEqual({ itemId: { from: null, to: mixer.id }, method: { from: null, to: 'scan' } });
  });

  it('reports an item as misplaced only from the checklist of another location, and keeps its row there', async () => {
    const { write } = await setup();
    const { run, top, patro, mixer, cap } = await startedRun(write);

    const there = await expectJson(await scan(write, run.id, { code: cap.code, locationId: patro.id }), 200, scanResultSchema);
    expect(there).toMatchObject({ outcome: 'found', misplaced: false });

    const elsewhere = await expectJson(
      await scan(write, run.id, { code: mixer.code, locationId: patro.id }),
      200,
      scanResultSchema,
    );
    expect(elsewhere).toMatchObject({ outcome: 'found', misplaced: true, item: { path: [{ name: 'Centrála Praha' }] } });
    // No move: the row stays where it was listed.
    expect(elsewhere.outcome === 'found' && elsewhere.row.locationId).toBe(top.id);
  });

  it('adds an item that is not on the list as found elsewhere, where the user stands', async () => {
    const { read, write } = await setup();
    const { run, patro } = await startedRun(write);
    const sklad = await insertLocation(db().app, { name: 'Sklad' });
    const stranger = await insertItem(db().app, { name: 'Pokladní systém', locationId: sklad.id });

    const body = await expectJson(
      await scan(write, run.id, { code: stranger.code, locationId: patro.id, method: 'manual' }),
      200,
      scanResultSchema,
    );

    expect(body).toMatchObject({
      outcome: 'found_elsewhere',
      item: { id: stranger.id, path: [{ name: 'Sklad' }] },
      row: { kind: 'elsewhere', locationId: patro.id, method: 'manual', registeredPath: [{ name: 'Sklad' }] },
    });
    const detail = await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts).toMatchObject({ elsewhere: 1 });
    const rows = await expectJson(await read.get(`/inventories/${run.id}/items?locationId=${patro.id}`), 200, inventoryRowsSchema);
    expect(rows.items.map((r) => r.id)).toContain(stranger.id);
    expect((await auditOf(run.id)).at(-1)!.changes).toMatchObject({
      kind: { from: null, to: 'elsewhere' },
      locationId: { from: null, to: patro.id },
      registeredLocationId: { from: null, to: sklad.id },
    });
  });

  it('shows a found item as in place once an ordinary edit sets its location to the checklist', async () => {
    const { read, write } = await setup();
    const { run, patro } = await startedRun(write);
    const sklad = await insertLocation(db().app, { name: 'Sklad' });
    const stranger = await insertItem(db().app, { name: 'Pokladní systém', locationId: sklad.id });
    await scan(write, run.id, { code: stranger.code, locationId: patro.id });
    const rowsUrl = `/inventories/${run.id}/items?locationId=${patro.id}`;
    const find = async () =>
      (await expectJson(await read.get(rowsUrl), 200, inventoryRowsSchema)).items.find((r) => r.id === stranger.id);

    expect(await find()).toMatchObject({ kind: 'elsewhere', registeredElsewhere: true });

    const edited = await write.patch(`/items/${stranger.id}`, { locationId: patro.id, version: 1 });
    expect(edited.status).toBe(200);

    // Still the run's find (the counts keep it), but registered where it was found.
    expect(await find()).toMatchObject({ kind: 'elsewhere', registeredElsewhere: false, locationId: patro.id });
    const detail = await expectJson(await read.get(`/inventories/${run.id}`), 200, inventorySchema);
    expect(detail.counts).toMatchObject({ elsewhere: 1 });
  });

  it('answers that an item is already checked, with who checked it, and records nothing', async () => {
    const { write, admin } = await setup();
    const { run, mixer } = await startedRun(write);
    await scan(write, run.id, { code: mixer.code });

    const body = await expectJson(await scan(admin, run.id, { code: mixer.code }), 200, scanResultSchema);

    expect(body).toMatchObject({ outcome: 'already_checked', row: { id: mixer.id, checkedBy: run.startedBy } });
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'check']);
  });

  it('answers an archived item and an unknown code without recording anything', async () => {
    const { write } = await setup();
    const { run, ladder } = await startedRun(write);
    await db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, ladder.id));

    const archived = await expectJson(await scan(write, run.id, { code: ladder.code }), 200, scanResultSchema);
    expect(archived).toMatchObject({ outcome: 'archived', item: { id: ladder.id, name: 'Žebřík' } });
    const unknown = await expectJson(await scan(write, run.id, { code: 'INV-NOPE-1' }), 200, scanResultSchema);
    expect(unknown).toEqual({ outcome: 'unknown_code' });

    const rows = await db().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, run.id));
    expect(rows.every((row) => row.checkedAt === null)).toBe(true);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start']);
  });

  it('answers 404 for an unknown run, 409 for a run that is closed, 422 for a location outside the run', async () => {
    const { write } = await setup();
    const { run, mixer } = await startedRun(write);
    const brno = await insertLocation(db().app, { name: 'Centrála Brno' });

    await expectProblem(await scan(write, MISSING, { code: mixer.code }), 404, 'not_found');
    await expectProblem(
      await scan(write, run.id, { code: mixer.code, locationId: brno.id }),
      422,
      'location_outside_inventory',
    );
    await expectProblem(await scan(write, run.id, { code: mixer.code, locationId: MISSING }), 422, 'location_not_found');

    await write.post(`/inventories/${run.id}/cancel`, { version: run.version });
    await expectProblem(await scan(write, run.id, { code: mixer.code }), 409, 'inventory_closed');
    const rows = await db().app.select().from(inventoryItems).where(eq(inventoryItems.inventoryId, run.id));
    expect(rows.every((row) => row.checkedAt === null)).toBe(true);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'cancel']);
  });

  it('is for writers and signed-in users, and needs a code that has the form of an ID', async () => {
    const { app, read, admin, write } = await setup();
    const { run, mixer, cap } = await startedRun(write);
    await expectProblem(await scan(read, run.id, { code: mixer.code }), 403, 'forbidden');
    await expectProblem(await scan(api(app), run.id, { code: mixer.code }), 401, 'unauthenticated');
    for (const bad of [{}, { code: '' }, { code: 'https://example.com/q/1' }, { code: mixer.code, method: 'import' }, { code: mixer.code, locationId: 'LOC-001' }]) {
      await expectProblem(await scan(write, run.id, bad), 400, 'validation_error');
    }
    await expectProblem(await write.post('/inventories/nope/scans', { code: mixer.code }), 400, 'validation_error');
    await expectJson(await scan(admin, run.id, { code: cap.code }), 200, scanResultSchema);
    expect((await auditOf(run.id)).map((e) => e.action)).toEqual(['start', 'check']);
  });
});
