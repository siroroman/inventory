import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type {
  RecordDocument,
  RecordDocumentRepository,
  RecordDocumentWithAuthor,
} from '../../src/modules/service-record-documents/repository.ts';
import type { RecordDocumentRepos } from '../../src/modules/service-record-documents/service.ts';
import { createFakeAuditRepository } from './audit.ts';
import { bumpVersion as bump, fakeTransact } from './common.ts';
import { createFakeServiceRecordStore } from './service-records.ts';

/** Documents on top of the service record fake, which stays reachable for test setup. */
export function createFakeRecordDocumentStore() {
  const recordStore = createFakeServiceRecordStore();
  const state = { documents: [] as RecordDocument[], audit: [] as AuditEntry[] };
  /** Names of users by id, for "added by". */
  const userNames = new Map<string, string>();

  const byId = (id: string) => state.documents.find((d) => d.id === id);
  const author = (d: RecordDocument): RecordDocumentWithAuthor => ({
    ...d,
    createdByName: (d.createdBy && userNames.get(d.createdBy)) || null,
  });

  const documents: RecordDocumentRepository = {
    async list(serviceRecordId) {
      return state.documents
        .filter((d) => d.serviceRecordId === serviceRecordId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .map(author);
    },
    async findById(id) {
      const row = byId(id);
      return row && author(row);
    },
    async insert(values) {
      if (state.documents.some((d) => d.storageKey === values.storageKey)) {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'service_record_documents_storage_key_key',
        });
      }
      const row: RecordDocument = {
        id: randomUUID(),
        serviceRecordId: values.serviceRecordId,
        name: values.name,
        storageKey: values.storageKey,
        contentType: values.contentType,
        sizeBytes: values.sizeBytes,
        createdAt: new Date(),
        createdBy: values.createdBy,
        updatedAt: new Date(),
        updatedBy: values.createdBy,
        version: 1,
      };
      state.documents.push(row);
      return { ...row };
    },
    async rename(id, version, patch) {
      const row = byId(id);
      return row && bump(row, version, patch);
    },
    async delete(serviceRecordId, id) {
      const index = state.documents.findIndex((d) => d.id === id && d.serviceRecordId === serviceRecordId);
      return index < 0 ? undefined : state.documents.splice(index, 1)[0];
    },
  };

  const repos: RecordDocumentRepos = {
    documents,
    serviceRecords: recordStore.repos.serviceRecords,
    items: recordStore.repos.items,
    audit: createFakeAuditRepository(state.audit),
  };

  const snapshot = () => {
    const copy = structuredClone(state);
    const restoreRecords = recordStore.snapshot();
    return () => {
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        state[key].splice(0, state[key].length, ...(copy[key] as never[]));
      }
      restoreRecords();
    };
  };

  return {
    state,
    repos,
    transact: fakeTransact(repos, { snapshot }),
    recordStore,
    userNames,
    /** Test setup shortcut: a service record of an active item. */
    async addRecord() {
      const item = await recordStore.addItem();
      return { item, record: await recordStore.addRecord(item.id) };
    },
  };
}
