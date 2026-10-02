import { serviceRecordListSchema, serviceRecordSchema } from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, items } from '../../src/db/schema/index.ts';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertServiceRecord } from '../helpers/factories.ts';
import { api, expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

async function setup() {
  const { app } = createTestApp(db().app);
  return { app, ...(await roleClients(app, db().app)) };
}

const archiveItemRow = (id: string) => db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, id));

async function auditOf(id: string) {
  return db()
    .app.select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'service_record'), eq(auditLog.entityId, id)))
    .orderBy(auditLog.id);
}

describe('GET /items/{id}/service-records', () => {
  it("lists the item's records newest first, with a total", async () => {
    const { read } = await setup();
    const item = await insertItem(db().app);
    const other = await insertItem(db().app);
    await insertServiceRecord(db().app, { itemId: item.id, title: 'Roční prohlídka', performedOn: '2025-11-02' });
    await insertServiceRecord(db().app, { itemId: item.id, title: 'Výměna filtru', performedOn: '2026-04-15' });
    await insertServiceRecord(db().app, { itemId: other.id, title: 'Cizí' });

    const body = await expectJson(await read.get(`/items/${item.id}/service-records`), 200, serviceRecordListSchema);
    expect(body.items.map((r) => [r.title, r.performedOn])).toEqual([
      ['Výměna filtru', '2026-04-15'],
      ['Roční prohlídka', '2025-11-02'],
    ]);
    expect(body).toMatchObject({ total: 2, nextCursor: null });
  });

  it('pages with a cursor and leaves archived records out', async () => {
    const { read, write } = await setup();
    const item = await insertItem(db().app);
    for (const day of ['01', '02', '03']) {
      await insertServiceRecord(db().app, { itemId: item.id, title: `Záznam ${day}`, performedOn: `2026-03-${day}` });
    }
    const archived = await insertServiceRecord(db().app, { itemId: item.id, title: 'Smazaný', performedOn: '2026-03-04' });
    await write.post(`/service-records/${archived.id}/archive`, { version: 1 });

    const first = await expectJson(await read.get(`/items/${item.id}/service-records?limit=2`), 200, serviceRecordListSchema);
    expect(first.items.map((r) => r.title)).toEqual(['Záznam 03', 'Záznam 02']);
    expect(first.total).toBe(3);
    const next = await expectJson(
      await read.get(`/items/${item.id}/service-records?limit=2&cursor=${first.nextCursor}`),
      200,
      serviceRecordListSchema,
    );
    expect(next.items.map((r) => r.title)).toEqual(['Záznam 01']);
    expect(next.nextCursor).toBeNull();
  });

  it('still lists the records of an archived item', async () => {
    const { read } = await setup();
    const item = await insertItem(db().app);
    await insertServiceRecord(db().app, { itemId: item.id });
    await archiveItemRow(item.id);
    const body = await expectJson(await read.get(`/items/${item.id}/service-records`), 200, serviceRecordListSchema);
    expect(body.total).toBe(1);
  });

  it('answers 404 for an unknown item and 400 for bad input', async () => {
    const { read } = await setup();
    const item = await insertItem(db().app);
    await expectProblem(await read.get(`/items/${MISSING}/service-records`), 404, 'not_found');
    await expectProblem(await read.get('/items/nope/service-records'), 400, 'validation_error');
    await expectProblem(await read.get(`/items/${item.id}/service-records?limit=0`), 400, 'validation_error');
    await expectProblem(await read.get(`/items/${item.id}/service-records?cursor=garbage`), 400, 'invalid_cursor');
  });

  it('refuses an anonymous caller', async () => {
    const { app } = await setup();
    const item = await insertItem(db().app);
    await expectProblem(await api(app).get(`/items/${item.id}/service-records`), 401, 'unauthenticated');
  });
});

describe('GET /service-records/{id}', () => {
  it('returns the record with its item', async () => {
    const { read } = await setup();
    const item = await insertItem(db().app, { name: 'Kávovar Linea PB' });
    const record = await insertServiceRecord(db().app, {
      itemId: item.id,
      title: 'Výměna filtru a kontrola tlaku',
      performedOn: '2026-04-15',
      performedBy: 'Servis Novák s.r.o.',
      responsiblePerson: 'Jan Novák',
      description: 'Vyměněn vodní filtr.',
    });

    const body = await expectJson(await read.get(`/service-records/${record.id}`), 200, serviceRecordSchema);
    expect(body).toMatchObject({
      id: record.id,
      performedOn: '2026-04-15',
      title: 'Výměna filtru a kontrola tlaku',
      performedBy: 'Servis Novák s.r.o.',
      responsiblePerson: 'Jan Novák',
      description: 'Vyměněn vodní filtr.',
      version: 1,
      archivedAt: null,
      item: { id: item.id, code: item.code, name: 'Kávovar Linea PB', archivedAt: null },
    });
  });

  it('returns an archived record and says when its item is archived', async () => {
    const { read, write } = await setup();
    const item = await insertItem(db().app);
    const record = await insertServiceRecord(db().app, { itemId: item.id });
    await write.post(`/service-records/${record.id}/archive`, { version: 1 });
    await archiveItemRow(item.id);

    const body = await expectJson(await read.get(`/service-records/${record.id}`), 200, serviceRecordSchema);
    expect(body.archivedAt).not.toBeNull();
    expect(body.item.archivedAt).not.toBeNull();
  });

  it('answers 404 and 400', async () => {
    const { read } = await setup();
    await expectProblem(await read.get(`/service-records/${MISSING}`), 404, 'not_found');
    await expectProblem(await read.get('/service-records/nope'), 400, 'validation_error');
  });
});

describe('POST /items/{id}/service-records', () => {
  it('creates a record, trims the text, and writes the audit entry', async () => {
    const { write } = await setup();
    const item = await insertItem(db().app);

    const res = await write.post(`/items/${item.id}/service-records`, {
      performedOn: '2026-04-15',
      title: '  Výměna filtru  ',
      performedBy: 'Servis Novák s.r.o.',
    });
    const body = await expectJson(res, 201, serviceRecordSchema);
    expect(body).toMatchObject({
      title: 'Výměna filtru',
      performedBy: 'Servis Novák s.r.o.',
      responsiblePerson: null,
      description: null,
      version: 1,
      item: { id: item.id },
    });
    const [entry] = await auditOf(body.id);
    expect(entry).toMatchObject({ action: 'create', entityType: 'service_record' });
  });

  it.each([
    ['no title', { performedOn: '2026-04-15' }],
    ['a blank title', { performedOn: '2026-04-15', title: '   ' }],
    ['no date', { title: 'X' }],
    ['a date that does not exist', { performedOn: '2026-02-31', title: 'X' }],
    ['a date with a time', { performedOn: '2026-04-15T10:00:00Z', title: 'X' }],
    ['an empty optional field', { performedOn: '2026-04-15', title: 'X', description: '' }],
    ['a too long title', { performedOn: '2026-04-15', title: 'x'.repeat(201) }],
    ['an unknown field', { performedOn: '2026-04-15', title: 'X', itemId: MISSING }],
  ])('rejects %s', async (_, body) => {
    const { write } = await setup();
    const item = await insertItem(db().app);
    await expectProblem(await write.post(`/items/${item.id}/service-records`, body), 400, 'validation_error');
  });

  it('answers 404 for an unknown item and 409 for an archived one', async () => {
    const { write } = await setup();
    const item = await insertItem(db().app);
    const body = { performedOn: '2026-04-15', title: 'X' };
    await expectProblem(await write.post(`/items/${MISSING}/service-records`, body), 404, 'not_found');
    await archiveItemRow(item.id);
    await expectProblem(await write.post(`/items/${item.id}/service-records`, body), 409, 'archived');
  });
});

describe('PATCH /service-records/{id}', () => {
  it('changes the fields sent, clears with null and audits the difference', async () => {
    const { write } = await setup();
    const record = await insertServiceRecord(db().app, { performedBy: 'Servis Novák', description: 'Poznámka' });

    const res = await write.patch(`/service-records/${record.id}`, { version: 1, title: 'Roční prohlídka', description: null });
    const body = await expectJson(res, 200, serviceRecordSchema);
    expect(body).toMatchObject({
      title: 'Roční prohlídka',
      description: null,
      performedBy: 'Servis Novák',
      performedOn: '2026-04-15',
      version: 2,
    });
    const entries = await auditOf(record.id);
    expect(entries.at(-1)).toMatchObject({
      action: 'update',
      changes: { title: { from: 'Výměna filtru', to: 'Roční prohlídka' }, description: { from: 'Poznámka', to: null } },
    });
  });

  it('answers 409 for a stale version and for an archived record or item, 404 for an unknown record', async () => {
    const { write } = await setup();
    const record = await insertServiceRecord(db().app);
    await write.patch(`/service-records/${record.id}`, { version: 1, title: 'Nové' });
    await expectProblem(await write.patch(`/service-records/${record.id}`, { version: 1, title: 'Starší' }), 409, 'conflict');
    await expectProblem(await write.patch(`/service-records/${MISSING}`, { version: 1, title: 'X' }), 404, 'not_found');

    await write.post(`/service-records/${record.id}/archive`, { version: 2 });
    await expectProblem(await write.patch(`/service-records/${record.id}`, { version: 3, title: 'X' }), 409, 'archived');

    const other = await insertServiceRecord(db().app);
    await archiveItemRow(other.itemId);
    await expectProblem(await write.patch(`/service-records/${other.id}`, { version: 1, title: 'X' }), 409, 'archived');
  });

  it.each([
    ['no version', { title: 'X' }],
    ['nothing to change', { version: 1 }],
    ['a null title', { version: 1, title: null }],
    ['a null date', { version: 1, performedOn: null }],
    ['a blank title', { version: 1, title: ' ' }],
    ['a bad date', { version: 1, performedOn: '15. 4. 2026' }],
    ['an item change', { version: 1, itemId: MISSING }],
  ])('rejects %s', async (_, body) => {
    const { write } = await setup();
    const record = await insertServiceRecord(db().app);
    await expectProblem(await write.patch(`/service-records/${record.id}`, body), 400, 'validation_error');
  });
});

describe('POST /service-records/{id}/archive and /restore', () => {
  it('archives, hides the record from the item list, restores it, and audits both', async () => {
    const { write, read } = await setup();
    const record = await insertServiceRecord(db().app);

    const archived = await expectJson(await write.post(`/service-records/${record.id}/archive`, { version: 1 }), 200, serviceRecordSchema);
    expect(archived).toMatchObject({ version: 2 });
    expect(archived.archivedAt).not.toBeNull();
    const list = await expectJson(await read.get(`/items/${record.itemId}/service-records`), 200, serviceRecordListSchema);
    expect(list).toMatchObject({ items: [], total: 0 });

    const restored = await expectJson(await write.post(`/service-records/${record.id}/restore`, { version: 2 }), 200, serviceRecordSchema);
    expect(restored).toMatchObject({ archivedAt: null, version: 3 });
    expect((await auditOf(record.id)).map((e) => e.action)).toEqual(['archive', 'restore']);
  });

  it('answers 409 and 404 for states that do not allow it', async () => {
    const { write } = await setup();
    const record = await insertServiceRecord(db().app);
    await expectProblem(await write.post(`/service-records/${record.id}/restore`, { version: 1 }), 409, 'not_archived');
    await expectProblem(await write.post(`/service-records/${record.id}/archive`, { version: 7 }), 409, 'conflict');
    await write.post(`/service-records/${record.id}/archive`, { version: 1 });
    await expectProblem(await write.post(`/service-records/${record.id}/archive`, { version: 2 }), 409, 'archived');
    await expectProblem(await write.post(`/service-records/${MISSING}/archive`, { version: 1 }), 404, 'not_found');
    await expectProblem(await write.post(`/service-records/${record.id}/archive`, {}), 400, 'validation_error');
  });
});

describe('roles on the service record routes', () => {
  it('lets read users read but not write', async () => {
    const { read } = await setup();
    const record = await insertServiceRecord(db().app);
    for (const path of [`/items/${record.itemId}/service-records`, `/service-records/${record.id}`]) {
      expect((await read.get(path)).status, path).toBe(200);
    }
    const body = { performedOn: '2026-05-01', title: 'X' };
    await expectProblem(await read.post(`/items/${record.itemId}/service-records`, body), 403, 'forbidden');
    await expectProblem(await read.patch(`/service-records/${record.id}`, { version: 1, title: 'X' }), 403, 'forbidden');
    await expectProblem(await read.post(`/service-records/${record.id}/archive`, { version: 1 }), 403, 'forbidden');
    await expectProblem(await read.post(`/service-records/${record.id}/restore`, { version: 1 }), 403, 'forbidden');
  });

  it('lets write and admin users write, and changes nothing for a refused request', async () => {
    const { read, write, admin } = await setup();
    const item = await insertItem(db().app);
    const body = { performedOn: '2026-05-01', title: 'X' };
    await read.post(`/items/${item.id}/service-records`, body);
    expect((await expectJson(await read.get(`/items/${item.id}/service-records`), 200, serviceRecordListSchema)).total).toBe(0);
    expect((await write.post(`/items/${item.id}/service-records`, body)).status).toBe(201);
    expect((await admin.post(`/items/${item.id}/service-records`, body)).status).toBe(201);
  });
});
