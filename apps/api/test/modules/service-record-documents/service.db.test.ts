import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createRecordDocumentService, recordDocumentRepos } from '../../../src/modules/service-record-documents/service.ts';
import { createFakeStorage } from '../../fakes/storage.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertServiceRecord, insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database. The
// bucket stays a fake.
describe('record document service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { role: 'write', name: 'Jana Nováková' });
    const actor: Actor = { id: user.id, role: 'write' };
    const bucket = createFakeStorage();
    let counter = 0;
    const service = createRecordDocumentService({
      repos: recordDocumentRepos(t().app),
      transact: transactor(t().app, recordDocumentRepos),
      storage: bucket.storage,
      newId: () => `doc${++counter}`,
    });
    const record = await insertServiceRecord(t().app);
    const addDocument = async (name = 'Protokol') => {
      const { key } = await service.requestUpload(actor, record.id, { contentType: 'application/pdf', size: 1000 });
      bucket.upload(key, { contentType: 'application/pdf', size: 1000 });
      return service.confirm(actor, record.id, { key, name });
    };
    return { actor, bucket, service, repos: recordDocumentRepos(t().app), record, addDocument };
  }

  it('adds, renames and removes documents, each change with its audit entry, and names the author', async () => {
    const { actor, bucket, service, repos, record, addDocument } = await setup();
    const document = await addDocument('Stará');
    expect(document).toMatchObject({ createdBy: actor.id, createdByName: 'Jana Nováková' });
    const renamed = await service.rename(actor, record.id, document.id, { name: 'Nová', version: 1 });
    expect(renamed).toMatchObject({ name: 'Nová', version: 2, updatedBy: actor.id });
    await service.remove(actor, record.id, document.id);

    expect(await service.list(actor, record.id)).toEqual([]);
    expect(bucket.deleted).toEqual([document.storageKey]);
    const history = await repos.audit.list({ entityType: 'service_record_document', entityId: document.id }, { limit: 10 });
    expect(history.items.map((e) => e.action)).toEqual(['delete', 'update', 'create']);
  });

  it('leaves nothing behind when the database rejects a write', async () => {
    const { actor, service, repos, record, addDocument } = await setup();
    const document = await addDocument();
    // Same key again: the unique constraint fails after the stored file was checked.
    const error = service.confirm(actor, record.id, { key: document.storageKey, name: 'Znovu' });
    await expectPgError(error, { code: PG.uniqueViolation, constraint: 'service_record_documents_storage_key_key' });
    expect(await repos.documents.list(record.id)).toHaveLength(1);
    const history = await repos.audit.list({ entityType: 'service_record_document', entityId: document.id }, { limit: 10 });
    expect(history.items).toHaveLength(1);
  });
});
