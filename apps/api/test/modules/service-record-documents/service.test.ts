import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { createRecordDocumentService, downloadName } from '../../../src/modules/service-record-documents/service.ts';
import { createFakeRecordDocumentStore } from '../../fakes/service-record-documents.ts';
import { createFakeStorage } from '../../fakes/storage.ts';
import { expectCode } from '../../helpers/service-errors.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function setup() {
  const store = createFakeRecordDocumentStore();
  store.userNames.set(writer.id, 'Jana Nováková');
  const bucket = createFakeStorage();
  let counter = 0;
  const service = createRecordDocumentService({ ...store, storage: bucket.storage, newId: () => `doc${++counter}` });
  const { item, record } = await store.addRecord();
  /** Requests an upload, "uploads" the file and confirms it. */
  const addDocument = async (
    options: { recordId?: string; contentType?: string; size?: number; name?: string; stored?: { size?: number; contentType?: string } } = {},
  ) => {
    const { recordId = record.id, contentType = PDF, size = 100_000, name = 'Servisní protokol', stored } = options;
    const { key } = await service.requestUpload(writer, recordId, { contentType, size });
    bucket.upload(key, { size, contentType, ...stored });
    return service.confirm(writer, recordId, { key, name });
  };
  return { store, bucket, service, item, record, addDocument };
}

describe('record document service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, bucket, service, record, addDocument } = await setup();
      const document = await addDocument();
      const auditBefore = store.state.audit.length;

      await expect(service.list(reader, record.id)).resolves.toHaveLength(1);
      await expectCode(service.requestUpload(reader, record.id, { contentType: PDF, size: 10 }), 'forbidden');
      await expectCode(service.confirm(reader, record.id, { key: 'service-records/x/doc.pdf', name: 'x' }), 'forbidden');
      await expectCode(service.rename(reader, record.id, document.id, { name: 'Jiný', version: 1 }), 'forbidden');
      await expectCode(service.remove(reader, record.id, document.id), 'forbidden');

      expect(store.state.documents).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
      expect(bucket.deleted).toEqual([]);
    });

    it('lets writers and admins add documents', async () => {
      const { service, record } = await setup();
      await expect(service.requestUpload(writer, record.id, { contentType: PDF, size: 10 })).resolves.toBeDefined();
      await expect(service.requestUpload(admin, record.id, { contentType: PDF, size: 10 })).resolves.toBeDefined();
    });
  });

  describe('requestUpload', () => {
    it('returns a key under the record and a link limited to the declared size', async () => {
      const { bucket, service, record } = await setup();
      const target = await service.requestUpload(writer, record.id, { contentType: XLSX, size: 54_321 });
      expect(target).toEqual({
        key: `service-records/${record.id}/doc1.xlsx`,
        uploadUrl: `https://storage.test/upload/service-records/${record.id}/doc1.xlsx`,
      });
      expect(bucket.uploadUrls).toEqual([{ key: target.key, contentType: XLSX, maxBytes: 54_321 }]);
    });

    it.each(DOCUMENT_CONTENT_TYPES)('accepts %s', async (contentType) => {
      const { service, record } = await setup();
      await expect(service.requestUpload(writer, record.id, { contentType, size: 10 })).resolves.toBeDefined();
    });

    it.each(['image/gif', 'image/heic', 'text/html', 'application/zip', ''])('refuses the type "%s"', async (contentType) => {
      const { bucket, service, record } = await setup();
      await expectCode(service.requestUpload(writer, record.id, { contentType, size: 10 }), 'document_type_not_allowed');
      expect(bucket.uploadUrls).toEqual([]);
    });

    it('refuses a file over 20 MB but accepts exactly 20 MB', async () => {
      const { service, record } = await setup();
      await expectCode(service.requestUpload(writer, record.id, { contentType: PDF, size: MAX_DOCUMENT_BYTES + 1 }), 'document_too_large');
      await expect(service.requestUpload(writer, record.id, { contentType: PDF, size: MAX_DOCUMENT_BYTES })).resolves.toBeDefined();
    });

    it('refuses an unknown record', async () => {
      const { service } = await setup();
      await expectCode(service.requestUpload(writer, 'missing', { contentType: PDF, size: 10 }), 'not_found');
    });

    it('refuses an archived record and a record of an archived item', async () => {
      const { store, service, item, record } = await setup();
      const other = await store.recordStore.addRecord(item.id);
      await store.recordStore.repos.serviceRecords.setArchived(other.id, other.version, true, 'setup');
      await expectCode(service.requestUpload(writer, other.id, { contentType: PDF, size: 10 }), 'archived');

      await store.recordStore.itemStore.repos.items.setArchived(item.id, item.version, true, 'setup');
      await expectCode(service.requestUpload(writer, record.id, { contentType: PDF, size: 10 }), 'archived');
    });
  });

  describe('confirm', () => {
    it('records the stored file under the given name, by the actor, and audits it', async () => {
      const { store, record, addDocument } = await setup();
      const document = await addDocument({ name: 'Revizní zpráva', size: 123_456 });

      expect(document).toMatchObject({
        serviceRecordId: record.id,
        name: 'Revizní zpráva',
        contentType: PDF,
        sizeBytes: 123_456,
        createdBy: writer.id,
        createdByName: 'Jana Nováková',
        version: 1,
        url: `https://storage.test/${document.storageKey}?ttl=900&name=${encodeURIComponent('Revizní zpráva.pdf')}`,
      });
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: writer.id,
        entityType: 'service_record_document',
        entityId: document.id,
        action: 'create',
        changes: {
          serviceRecordId: { from: null, to: record.id },
          name: { from: null, to: 'Revizní zpráva' },
          storageKey: { from: null, to: document.storageKey },
          contentType: { from: null, to: PDF },
        },
      });
    });

    it('takes size and type from the stored file, not from the request', async () => {
      const { addDocument } = await setup();
      // Asked for 100 kB, the stored file is 90 kB.
      const document = await addDocument({ size: 100_000, stored: { size: 90_000 } });
      expect(document.sizeBytes).toBe(90_000);
    });

    it.each([
      ['a key of another record', (id: string) => `service-records/other/${id}.pdf`],
      ['a key outside service-records', (id: string) => `items/${id}.pdf`],
      ['an unknown extension', (id: string) => `service-records/RECORD/${id}.exe`],
      ['a path trick', () => 'service-records/RECORD/../x.pdf'],
    ])('refuses %s', async (_, makeKey) => {
      const { bucket, service, record } = await setup();
      const key = makeKey('doc1').replace('RECORD', record.id);
      bucket.upload(key);
      await expectCode(service.confirm(writer, record.id, { key, name: 'x' }), 'invalid_document_key');
    });

    it('refuses a file that was never uploaded or is empty', async () => {
      const { bucket, service, record } = await setup();
      const { key } = await service.requestUpload(writer, record.id, { contentType: PDF, size: 10 });
      await expectCode(service.confirm(writer, record.id, { key, name: 'x' }), 'document_not_uploaded');
      bucket.upload(key, { size: 0, contentType: PDF });
      await expectCode(service.confirm(writer, record.id, { key, name: 'x' }), 'document_not_uploaded');
    });

    it('refuses a stored file that is too big or of another type than its key', async () => {
      const { addDocument } = await setup();
      await expectCode(addDocument({ stored: { size: MAX_DOCUMENT_BYTES + 1 } }), 'document_too_large');
      await expectCode(addDocument({ stored: { contentType: 'text/html' } }), 'document_type_not_allowed');
      await expectCode(addDocument({ stored: { contentType: 'image/png' } }), 'document_type_not_allowed');
    });

    it('refuses a key that is already recorded, leaving no second row or audit entry', async () => {
      const { store, service, record, addDocument } = await setup();
      const document = await addDocument();
      const auditBefore = store.state.audit.length;
      await expect(service.confirm(writer, record.id, { key: document.storageKey, name: 'Znovu' })).rejects.toMatchObject({
        constraint: 'service_record_documents_storage_key_key',
      });
      expect(store.state.documents).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('refuses to add under an archived record or item', async () => {
      const { store, service, item, record } = await setup();
      const { key } = await service.requestUpload(writer, record.id, { contentType: PDF, size: 10 });
      await store.recordStore.itemStore.repos.items.setArchived(item.id, item.version, true, 'setup');
      await expectCode(service.confirm(writer, record.id, { key, name: 'x' }), 'archived');
      expect(store.state.documents).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('lists the newest first, with author and read URL, and only this record', async () => {
      const { store, service, record, addDocument } = await setup();
      const first = await addDocument({ name: 'První' });
      const second = await addDocument({ name: 'Druhý', contentType: XLSX });
      store.state.documents.find((d) => d.id === first.id)!.createdAt = new Date('2026-01-01');
      const other = await store.recordStore.addRecord(record.itemId);
      await addDocument({ recordId: other.id, name: 'Cizí' });

      const list = await service.list(reader, record.id);
      expect(list.map((d) => d.name)).toEqual(['Druhý', 'První']);
      expect(list[0]).toMatchObject({ id: second.id, createdByName: 'Jana Nováková' });
      expect(list[0]?.url).toContain('ttl=900');
      expect(list[0]?.url).toContain(encodeURIComponent('Druhý.xlsx'));
    });

    it('lists the documents of an archived record and item, and refuses an unknown record', async () => {
      const { store, service, item, record, addDocument } = await setup();
      await addDocument();
      await store.recordStore.repos.serviceRecords.setArchived(record.id, record.version, true, 'setup');
      await store.recordStore.itemStore.repos.items.setArchived(item.id, item.version, true, 'setup');
      await expect(service.list(reader, record.id)).resolves.toHaveLength(1);
      await expectCode(service.list(reader, 'missing'), 'not_found');
    });
  });

  describe('rename', () => {
    it('changes the name, bumps the version and audits the change', async () => {
      const { store, service, record, addDocument } = await setup();
      const document = await addDocument({ name: 'Stará' });
      const renamed = await service.rename(admin, record.id, document.id, { name: 'Nová', version: 1 });
      expect(renamed).toMatchObject({ name: 'Nová', version: 2, createdBy: writer.id });
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: admin.id,
        action: 'update',
        entityId: document.id,
        changes: { name: { from: 'Stará', to: 'Nová' } },
      });
    });

    it('does nothing, and audits nothing, when the name is the same', async () => {
      const { store, service, record, addDocument } = await setup();
      const document = await addDocument({ name: 'Stejná' });
      const auditBefore = store.state.audit.length;
      await expect(service.rename(writer, record.id, document.id, { name: 'Stejná', version: 1 })).resolves.toMatchObject({ version: 1 });
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('returns a conflict for a stale version', async () => {
      const { store, service, record, addDocument } = await setup();
      const document = await addDocument();
      await service.rename(writer, record.id, document.id, { name: 'Jiná', version: 1 });
      const auditBefore = store.state.audit.length;
      await expectCode(service.rename(writer, record.id, document.id, { name: 'Třetí', version: 1 }), 'conflict');
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('refuses a document of another record, and an archived record', async () => {
      const { store, service, record, addDocument } = await setup();
      const document = await addDocument();
      const other = await store.recordStore.addRecord(record.itemId);
      await expectCode(service.rename(writer, other.id, document.id, { name: 'x', version: 1 }), 'not_found');
      await expectCode(service.rename(writer, record.id, 'missing', { name: 'x', version: 1 }), 'not_found');

      await store.recordStore.repos.serviceRecords.setArchived(record.id, record.version, true, 'setup');
      await expectCode(service.rename(writer, record.id, document.id, { name: 'x', version: 1 }), 'archived');
    });
  });

  describe('remove', () => {
    it('deletes the row and the stored file, and audits it', async () => {
      const { store, bucket, service, record, addDocument } = await setup();
      const document = await addDocument({ name: 'Smazat' });
      await service.remove(writer, record.id, document.id);

      expect(store.state.documents).toEqual([]);
      expect(bucket.deleted).toEqual([document.storageKey]);
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: writer.id,
        action: 'delete',
        entityId: document.id,
        changes: { name: { from: 'Smazat', to: null }, storageKey: { from: document.storageKey, to: null } },
      });
    });

    it('still succeeds when the file cannot be deleted', async () => {
      const { store, bucket, service, record, addDocument } = await setup();
      const document = await addDocument();
      bucket.state.failDelete = true;
      await expect(service.remove(writer, record.id, document.id)).resolves.toBeUndefined();
      expect(store.state.documents).toEqual([]);
    });

    it('refuses an unknown document, one of another record and an archived record, deleting nothing', async () => {
      const { store, bucket, service, record, addDocument } = await setup();
      const document = await addDocument();
      const other = await store.recordStore.addRecord(record.itemId);
      await expectCode(service.remove(writer, record.id, 'missing'), 'not_found');
      await expectCode(service.remove(writer, other.id, document.id), 'not_found');

      await store.recordStore.repos.serviceRecords.setArchived(record.id, record.version, true, 'setup');
      await expectCode(service.remove(writer, record.id, document.id), 'archived');
      expect(store.state.documents).toHaveLength(1);
      expect(bucket.deleted).toEqual([]);
    });
  });
});

describe('downloadName', () => {
  it('adds the extension of the type unless the name already ends with it', () => {
    expect(downloadName('Protokol', PDF)).toBe('Protokol.pdf');
    expect(downloadName('Protokol.PDF', PDF)).toBe('Protokol.PDF');
    expect(downloadName('Tabulka', XLSX)).toBe('Tabulka.xlsx');
    expect(downloadName('Foto', 'text/plain')).toBe('Foto');
  });
});
