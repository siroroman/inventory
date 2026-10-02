import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from '@inventory/shared';
import { serviceRecordDocuments } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertServiceRecord, insertServiceRecordDocument, insertUser } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('service_record_documents', () => {
  const t = useTestDb();
  const document = (serviceRecordId: string, overrides: Partial<typeof serviceRecordDocuments.$inferInsert> = {}) =>
    insertServiceRecordDocument(t().app, { serviceRecordId, ...overrides });

  // The list lives in shared (for the services and the SPA) and in the CHECK; they must not drift.
  it.each(DOCUMENT_CONTENT_TYPES)('accepts %s', async (contentType) => {
    const record = await insertServiceRecord(t().app);
    await document(record.id, { contentType });
  });

  it.each(['image/heic', 'image/svg+xml', 'text/html', 'application/zip', 'application/x-msdownload'])(
    'rejects %s',
    async (contentType) => {
      const record = await insertServiceRecord(t().app);
      await expectPgError(document(record.id, { contentType }), {
        code: PG.checkViolation,
        constraint: 'service_record_documents_content_type_allowed',
      });
    },
  );

  it.each([0, -1, MAX_DOCUMENT_BYTES + 1])('rejects the size %i', async (sizeBytes) => {
    const record = await insertServiceRecord(t().app);
    await expectPgError(document(record.id, { sizeBytes }), {
      code: PG.checkViolation,
      constraint: 'service_record_documents_size_range',
    });
  });

  it('accepts the largest allowed size', async () => {
    const record = await insertServiceRecord(t().app);
    await document(record.id, { sizeBytes: MAX_DOCUMENT_BYTES });
  });

  it('rejects a blank name', async () => {
    const record = await insertServiceRecord(t().app);
    await expectPgError(document(record.id, { name: '   ' }), {
      code: PG.checkViolation,
      constraint: 'service_record_documents_name_not_blank',
    });
  });

  it('rejects a reused storage key', async () => {
    const record = await insertServiceRecord(t().app);
    await document(record.id, { storageKey: 'service-records/a.pdf' });
    await expectPgError(document(record.id, { storageKey: 'service-records/a.pdf' }), {
      code: PG.uniqueViolation,
      constraint: 'service_record_documents_storage_key_key',
    });
  });

  it('rejects an unknown record', async () => {
    await expectPgError(insertServiceRecordDocument(t().app, { serviceRecordId: randomUUID() }), {
      code: PG.foreignKeyViolation,
      constraint: 'service_record_documents_record_id_fk',
    });
  });

  it('keeps the author and counts versions on rename', async () => {
    const author = await insertUser(t().app);
    const row = await document((await insertServiceRecord(t().app)).id, { createdBy: author.id });
    expect(row.version).toBe(1);
    const [renamed] = await t()
      .app.update(serviceRecordDocuments)
      .set({ name: 'Nový název', updatedBy: author.id })
      .where(eq(serviceRecordDocuments.id, row.id))
      .returning();
    expect(renamed).toMatchObject({ name: 'Nový název', version: 2, createdBy: author.id });
    expect(renamed!.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
  });

  it('can be deleted by the app, and a record with documents cannot', async () => {
    const record = await insertServiceRecord(t().app);
    const row = await document(record.id);
    await expectPgError(t().owner.execute(`DELETE FROM service_records WHERE id = '${record.id}'`), {
      code: PG.foreignKeyViolation,
    });
    await t().app.delete(serviceRecordDocuments).where(eq(serviceRecordDocuments.id, row.id));
    expect(await t().app.select().from(serviceRecordDocuments)).toEqual([]);
  });
});
