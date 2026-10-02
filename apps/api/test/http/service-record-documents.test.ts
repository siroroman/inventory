import { documentListSchema, documentSchema, MAX_DOCUMENT_BYTES, uploadTargetSchema } from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, items, serviceRecordDocuments, serviceRecords, user } from '../../src/db/schema/index.ts';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertServiceRecord } from '../helpers/factories.ts';
import { expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';
const PDF = 'application/pdf';

async function setup() {
  const { app, bucket } = createTestApp(db().app);
  const clients = await roleClients(app, db().app);
  const record = await insertServiceRecord(db().app);
  type Client = (typeof clients)['write'];

  /** Both steps of adding a document: ask for the URL, "upload" the file, confirm it. */
  const addDocument = async (
    options: { recordId?: string; client?: Client; name?: string; contentType?: string; size?: number } = {},
  ) => {
    const { recordId = record.id, client = clients.write, name = 'Servisní protokol', contentType = PDF, size = 50_000 } = options;
    const target = await expectJson(
      await client.post(`/service-records/${recordId}/documents/upload-url`, { contentType, size }),
      200,
      uploadTargetSchema,
    );
    bucket.upload(target.key, { contentType, size });
    return expectJson(await client.post(`/service-records/${recordId}/documents`, { key: target.key, name }), 201, documentSchema);
  };
  const documents = async (recordId = record.id) =>
    expectJson(await clients.read.get(`/service-records/${recordId}/documents`), 200, documentListSchema);
  const archiveRecord = (recordId = record.id) =>
    db().app.update(serviceRecords).set({ archivedAt: new Date() }).where(eq(serviceRecords.id, recordId));
  const archiveItem = () => db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, record.itemId));
  return { ...clients, bucket, record, addDocument, documents, archiveRecord, archiveItem };
}

async function auditOf(id: string) {
  return db()
    .app.select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'service_record_document'), eq(auditLog.entityId, id)))
    .orderBy(auditLog.id);
}

describe('adding a document', () => {
  it('takes two steps and lists the document with its name, date, author and a 15-minute read URL', async () => {
    const { write, bucket, record, documents } = await setup();
    expect(await documents()).toEqual([]);

    const target = await expectJson(
      await write.post(`/service-records/${record.id}/documents/upload-url`, { contentType: PDF, size: 123_456 }),
      200,
      uploadTargetSchema,
    );
    expect(target.key).toMatch(new RegExp(`^service-records/${record.id}/[0-9a-f-]{36}\\.pdf$`));
    expect(target.uploadUrl).toContain(target.key);
    expect(bucket.uploadUrls).toEqual([{ key: target.key, contentType: PDF, maxBytes: 123_456 }]);
    // Nothing is recorded until the upload is confirmed.
    expect(await documents()).toEqual([]);

    bucket.upload(target.key, { contentType: PDF, size: 123_456 });
    const document = await expectJson(
      await write.post(`/service-records/${record.id}/documents`, { key: target.key, name: '  Revizní zpráva  ' }),
      201,
      documentSchema,
    );
    expect(document).toMatchObject({ name: 'Revizní zpráva', contentType: PDF, size: 123_456, version: 1 });
    expect(document.url).toBe(`https://storage.test/${target.key}?ttl=900&name=${encodeURIComponent('Revizní zpráva.pdf')}`);
    expect(document.downloadUrl).toBe(`${document.url}&download=1`);
    expect(document).not.toHaveProperty('storageKey');

    const [author] = await db().app.select().from(user).where(eq(user.id, document.createdBy!.id));
    expect(document.createdBy).toEqual({ id: author!.id, name: author!.name });
    expect(Date.now() - new Date(document.createdAt).getTime()).toBeLessThan(60_000);
    expect(await documents()).toEqual([document]);
  });

  it('lists the newest first, and only the record\'s own documents', async () => {
    const { record, addDocument, documents } = await setup();
    const first = await addDocument({ name: 'První' });
    const second = await addDocument({ name: 'Druhý' });
    await db()
      .app.update(serviceRecordDocuments)
      .set({ createdAt: new Date('2026-01-01') })
      .where(eq(serviceRecordDocuments.id, first.id));
    const other = await insertServiceRecord(db().app, { itemId: record.itemId });
    await addDocument({ recordId: other.id, name: 'Cizí' });
    expect((await documents()).map((d) => d.id)).toEqual([second.id, first.id]);
  });

  it('audits the new document', async () => {
    const { record, addDocument } = await setup();
    const document = await addDocument();
    const [entry, ...rest] = await auditOf(document.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'create', changes: { serviceRecordId: { from: null, to: record.id } } });
  });

  it('refuses types other than PDF, images, Word and Excel, and files over 20 MB', async () => {
    const { write, record, bucket } = await setup();
    const url = `/service-records/${record.id}/documents/upload-url`;
    for (const contentType of ['image/gif', 'image/heic', 'text/html', 'application/zip']) {
      await expectProblem(await write.post(url, { contentType, size: 10 }), 422, 'document_type_not_allowed');
    }
    await expectProblem(await write.post(url, { contentType: PDF, size: MAX_DOCUMENT_BYTES + 1 }), 422, 'document_too_large');
    expect(bucket.uploadUrls).toEqual([]);
  });

  it('answers 404 for an unknown record and 409 for an archived record or item', async () => {
    const { write, record, archiveRecord, archiveItem, bucket } = await setup();
    const body = { contentType: PDF, size: 10 };
    await expectProblem(await write.post(`/service-records/${MISSING}/documents/upload-url`, body), 404, 'not_found');
    await expectProblem(await write.post(`/service-records/${MISSING}/documents`, { key: 'service-records/x/a.pdf', name: 'x' }), 404, 'not_found');

    await archiveItem();
    await expectProblem(await write.post(`/service-records/${record.id}/documents/upload-url`, body), 409, 'archived');
    const key = `service-records/${record.id}/a.pdf`;
    bucket.upload(key);
    await expectProblem(await write.post(`/service-records/${record.id}/documents`, { key, name: 'x' }), 409, 'archived');

    await db().app.update(items).set({ archivedAt: null }).where(eq(items.id, record.itemId));
    await archiveRecord();
    await expectProblem(await write.post(`/service-records/${record.id}/documents/upload-url`, body), 409, 'archived');
  });

  it('validates the request bodies', async () => {
    const { write, record } = await setup();
    const url = `/service-records/${record.id}/documents/upload-url`;
    for (const body of [{}, { contentType: PDF }, { size: 10 }, { contentType: PDF, size: 0 }, { contentType: PDF, size: 1.5 }, { contentType: PDF, size: 10, extra: 1 }]) {
      await expectProblem(await write.post(url, body), 400, 'validation_error');
    }
    await expectProblem(await write.post('/service-records/nope/documents/upload-url', { contentType: PDF, size: 10 }), 400, 'validation_error');
    const confirm = `/service-records/${record.id}/documents`;
    const key = `service-records/${record.id}/a.pdf`;
    for (const body of [{}, { key }, { name: 'x' }, { key, name: '   ' }, { key, name: 'x'.repeat(201) }, { key: '', name: 'x' }, { key, name: 'x', extra: 1 }]) {
      await expectProblem(await write.post(confirm, body), 400, 'validation_error');
    }
  });

  it('confirms only a file that is really in storage, and checks it there', async () => {
    const { write, record, bucket, documents } = await setup();
    const other = await insertServiceRecord(db().app);
    const confirm = (key: string, recordId = record.id) => write.post(`/service-records/${recordId}/documents`, { key, name: 'x' });
    const request = async (contentType = PDF) =>
      (await expectJson(await write.post(`/service-records/${record.id}/documents/upload-url`, { contentType, size: 10 }), 200, uploadTargetSchema)).key;

    await expectProblem(await confirm(`service-records/${other.id}/a.pdf`), 422, 'invalid_document_key');
    await expectProblem(await confirm(`service-records/${record.id}/a.exe`), 422, 'invalid_document_key');
    await expectProblem(await confirm(await request()), 422, 'document_not_uploaded');

    const big = await request();
    bucket.upload(big, { contentType: PDF, size: MAX_DOCUMENT_BYTES + 1 });
    await expectProblem(await confirm(big), 422, 'document_too_large');
    const html = await request();
    bucket.upload(html, { contentType: 'text/html' });
    await expectProblem(await confirm(html), 422, 'document_type_not_allowed');
    expect(await documents()).toEqual([]);

    const good = await request();
    bucket.upload(good, { contentType: PDF });
    await expectJson(await confirm(good), 201, documentSchema);
    await expectProblem(await confirm(good), 409, 'conflict');
    expect(await documents()).toHaveLength(1);
  });
});

describe('renaming a document', () => {
  it('changes the name with the version, and audits it', async () => {
    const { admin, record, addDocument, documents } = await setup();
    const document = await addDocument({ name: 'Stará' });
    const renamed = await expectJson(
      await admin.patch(`/service-records/${record.id}/documents/${document.id}`, { name: 'Nová', version: 1 }),
      200,
      documentSchema,
    );
    expect(renamed).toMatchObject({ name: 'Nová', version: 2, createdBy: document.createdBy });
    expect(renamed.url).toContain(encodeURIComponent('Nová.pdf'));
    expect((await documents()).map((d) => d.name)).toEqual(['Nová']);
    const entries = await auditOf(document.id);
    expect(entries.at(-1)).toMatchObject({ action: 'update', changes: { name: { from: 'Stará', to: 'Nová' } } });
  });

  it('answers 409 for a stale version and 404 for an unknown document or another record', async () => {
    const { write, record, addDocument } = await setup();
    const document = await addDocument();
    const url = `/service-records/${record.id}/documents/${document.id}`;
    await write.patch(url, { name: 'Jiná', version: 1 });
    await expectProblem(await write.patch(url, { name: 'Třetí', version: 1 }), 409, 'conflict');
    await expectProblem(await write.patch(`/service-records/${record.id}/documents/${MISSING}`, { name: 'x', version: 1 }), 404, 'not_found');
    const other = await insertServiceRecord(db().app);
    await expectProblem(await write.patch(`/service-records/${other.id}/documents/${document.id}`, { name: 'x', version: 1 }), 404, 'not_found');
    for (const body of [{}, { name: 'x' }, { version: 2 }, { name: ' ', version: 1 }, { name: 'x', version: 0 }, { name: 'x', version: 1, extra: 1 }]) {
      await expectProblem(await write.patch(url, body), 400, 'validation_error');
    }
  });

  it('answers 409 under an archived record', async () => {
    const { write, record, addDocument, archiveRecord } = await setup();
    const document = await addDocument();
    await archiveRecord();
    await expectProblem(await write.patch(`/service-records/${record.id}/documents/${document.id}`, { name: 'x', version: 1 }), 409, 'archived');
  });
});

describe('removing a document', () => {
  it('deletes the row and the stored file, and audits it', async () => {
    const { write, bucket, record, addDocument, documents } = await setup();
    const document = await addDocument();
    const stored = [...bucket.objects.keys()];
    const res = await write.delete(`/service-records/${record.id}/documents/${document.id}`);
    expect(res.status).toBe(204);
    expect(await documents()).toEqual([]);
    expect(bucket.deleted).toEqual(stored);
    expect((await auditOf(document.id)).map((e) => e.action)).toEqual(['create', 'delete']);
  });

  it('answers 404 for an unknown document or another record, and 409 under an archived record', async () => {
    const { write, record, bucket, addDocument, archiveRecord, documents } = await setup();
    const document = await addDocument();
    await expectProblem(await write.delete(`/service-records/${record.id}/documents/${MISSING}`), 404, 'not_found');
    const other = await insertServiceRecord(db().app);
    await expectProblem(await write.delete(`/service-records/${other.id}/documents/${document.id}`), 404, 'not_found');
    await archiveRecord();
    await expectProblem(await write.delete(`/service-records/${record.id}/documents/${document.id}`), 409, 'archived');
    expect(await documents()).toHaveLength(1);
    expect(bucket.deleted).toEqual([]);
  });
});

describe('access', () => {
  it('lets every role list, including under an archived record, and only writers change', async () => {
    const { read, write, admin, record, addDocument, archiveRecord, archiveItem } = await setup();
    const document = await addDocument();
    const base = `/service-records/${record.id}/documents`;
    for (const client of [read, write, admin]) {
      await expectJson(await client.get(base), 200, documentListSchema);
    }
    await archiveRecord();
    await archiveItem();
    await expectJson(await read.get(base), 200, documentListSchema);
    await expectProblem(await read.get(`/service-records/${MISSING}/documents`), 404, 'not_found');

    await expectProblem(await read.post(`${base}/upload-url`, { contentType: PDF, size: 10 }), 403, 'forbidden');
    await expectProblem(await read.post(base, { key: 'service-records/x/a.pdf', name: 'x' }), 403, 'forbidden');
    await expectProblem(await read.patch(`${base}/${document.id}`, { name: 'x', version: 1 }), 403, 'forbidden');
    await expectProblem(await read.delete(`${base}/${document.id}`), 403, 'forbidden');
  });

  it('answers 401 without a session', async () => {
    const { app } = createTestApp(db().app);
    const res = await app.request(`/api/v1/service-records/${MISSING}/documents`);
    await expectProblem(res, 401, 'unauthenticated');
  });
});
