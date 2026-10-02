import {
  DOCUMENT_TYPES,
  isDocumentType,
  MAX_DOCUMENT_BYTES,
  type RequestDocumentUploadBody,
} from '@inventory/shared';
import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import type { ObjectStorage } from '../../storage/storage.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createItemRepository, type ItemRepository } from '../items/repository.ts';
import { createServiceRecordRepository, type ServiceRecordRepository } from '../service-records/repository.ts';
import {
  createRecordDocumentRepository,
  type RecordDocumentRepository,
  type RecordDocumentWithAuthor,
} from './repository.ts';

export type RecordDocumentRepos = {
  documents: RecordDocumentRepository;
  /** Read-only here: documents belong to an existing record of an active item. */
  serviceRecords: ServiceRecordRepository;
  items: ItemRepository;
  audit: AuditRepository;
};

export const recordDocumentRepos = (db: DbExecutor): RecordDocumentRepos => ({
  documents: createRecordDocumentRepository(db),
  serviceRecords: createServiceRecordRepository(db),
  items: createItemRepository(db),
  audit: createAuditRepository(db),
});

export type RecordDocumentDeps = {
  repos: RecordDocumentRepos;
  transact: Transact<RecordDocumentRepos>;
  storage: ObjectStorage;
  /** Unique part of a new storage key (a UUID in production), injected to keep tests deterministic. */
  newId: () => string;
};

/** Read links in API responses stay valid this long. */
export const DOCUMENT_URL_TTL_SECONDS = 15 * 60;

/** `url` opens the file in the browser, `downloadUrl` saves it; both carry the document's name. */
export type RecordDocumentWithUrl = RecordDocumentWithAuthor & { url: string; downloadUrl: string };
export type DocumentUploadTarget = { key: string; uploadUrl: string };

const extensions = Object.values(DOCUMENT_TYPES).join('|');
const keyPattern = (recordId: string) => new RegExp(`^service-records/${recordId}/[A-Za-z0-9-]+\\.(${extensions})$`);

/** The name a download is saved under: the document's name with the extension of its type. */
export function downloadName(name: string, contentType: string): string {
  const extension = isDocumentType(contentType) ? DOCUMENT_TYPES[contentType] : undefined;
  if (!extension || name.toLowerCase().endsWith(`.${extension}`)) return name;
  return `${name}.${extension}`;
}

/** Documents are added to and changed under a record of an active item only; a record that is itself archived is read-only too. */
async function loadActiveRecord(r: RecordDocumentRepos, recordId: string): Promise<void> {
  const record = await r.serviceRecords.findById(recordId);
  if (!record) throw new DomainError('not_found');
  const item = await r.items.findById(record.itemId);
  if (!item) throw new DomainError('not_found');
  if (record.archivedAt || item.archivedAt) throw new DomainError('archived');
}

/** A document of this record, or not_found (also for one of another record). */
async function loadDocument(r: RecordDocumentRepos, recordId: string, documentId: string) {
  const document = await r.documents.findById(documentId);
  if (!document || document.serviceRecordId !== recordId) throw new DomainError('not_found');
  return document;
}

/**
 * Files attached to service records. Adding one takes two steps: `requestUpload` hands out a
 * signed URL, the browser uploads the file, then `confirm` records it once the file is really
 * there. Documents are deleted for real (the row, then the file); the audit log keeps the trace.
 */
export function createRecordDocumentService({ repos, transact, storage, newId }: RecordDocumentDeps) {
  const withUrl = async (document: RecordDocumentWithAuthor): Promise<RecordDocumentWithUrl> => {
    const fileName = downloadName(document.name, document.contentType);
    const [url, downloadUrl] = await Promise.all([
      storage.createReadUrl(document.storageKey, DOCUMENT_URL_TTL_SECONDS, { fileName }),
      storage.createReadUrl(document.storageKey, DOCUMENT_URL_TTL_SECONDS, { fileName, download: true }),
    ]);
    return { ...document, url, downloadUrl };
  };

  return {
    /** Newest first, each with a read URL valid for 15 minutes. Archived records and items included. */
    async list(actor: Actor, recordId: string): Promise<RecordDocumentWithUrl[]> {
      assertRole(actor, 'read');
      if (!(await repos.serviceRecords.findById(recordId))) throw new DomainError('not_found');
      return Promise.all((await repos.documents.list(recordId)).map(withUrl));
    },

    async requestUpload(actor: Actor, recordId: string, input: RequestDocumentUploadBody): Promise<DocumentUploadTarget> {
      assertRole(actor, 'write');
      await loadActiveRecord(repos, recordId);
      if (!isDocumentType(input.contentType)) throw new DomainError('document_type_not_allowed');
      if (input.size > MAX_DOCUMENT_BYTES) throw new DomainError('document_too_large');
      const key = `service-records/${recordId}/${newId()}.${DOCUMENT_TYPES[input.contentType]}`;
      // The link accepts a file of the declared size at most, so the bucket enforces what was asked for.
      return { key, uploadUrl: await storage.createUploadUrl(key, input.contentType, input.size) };
    },

    /** Records an uploaded file. The stored file is checked, not the client's word. */
    async confirm(actor: Actor, recordId: string, input: { key: string; name: string }): Promise<RecordDocumentWithUrl> {
      assertRole(actor, 'write');
      const row = await transact(async (r) => {
        await loadActiveRecord(r, recordId);
        if (!keyPattern(recordId).test(input.key)) throw new DomainError('invalid_document_key');
        const stored = await storage.head(input.key);
        if (!stored || stored.size <= 0) throw new DomainError('document_not_uploaded');
        if (stored.size > MAX_DOCUMENT_BYTES) throw new DomainError('document_too_large');
        // The extension in the key was chosen from the type that was asked for; both must still agree.
        if (!isDocumentType(stored.contentType) || !input.key.endsWith(`.${DOCUMENT_TYPES[stored.contentType]}`)) {
          throw new DomainError('document_type_not_allowed');
        }

        const inserted = await r.documents.insert({
          serviceRecordId: recordId,
          name: input.name,
          storageKey: input.key,
          contentType: stored.contentType,
          sizeBytes: stored.size,
          createdBy: actor.id,
        });
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_record_document',
          entityId: inserted.id,
          action: 'create',
          changes: {
            serviceRecordId: { from: null, to: recordId },
            name: { from: null, to: inserted.name },
            storageKey: { from: null, to: inserted.storageKey },
            contentType: { from: null, to: inserted.contentType },
          },
        });
        return (await r.documents.findById(inserted.id))!;
      });
      return withUrl(row);
    },

    async rename(
      actor: Actor,
      recordId: string,
      documentId: string,
      input: { name: string; version: number },
    ): Promise<RecordDocumentWithUrl> {
      assertRole(actor, 'write');
      const row = await transact(async (r) => {
        await loadActiveRecord(r, recordId);
        const current = await loadDocument(r, recordId, documentId);
        if (current.version !== input.version) throw new DomainError('conflict');
        if (current.name === input.name) return current;
        const updated = await r.documents.rename(documentId, input.version, { name: input.name, updatedBy: actor.id });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_record_document',
          entityId: documentId,
          action: 'update',
          changes: { name: { from: current.name, to: updated.name } },
        });
        return (await r.documents.findById(documentId))!;
      });
      return withUrl(row);
    },

    /** Deletes the row, then the stored file. A failed file delete only leaves an orphan behind. */
    async remove(actor: Actor, recordId: string, documentId: string): Promise<void> {
      assertRole(actor, 'write');
      const removed = await transact(async (r) => {
        await loadActiveRecord(r, recordId);
        const row = await r.documents.delete(recordId, documentId);
        if (!row) throw new DomainError('not_found');
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_record_document',
          entityId: documentId,
          action: 'delete',
          changes: {
            serviceRecordId: { from: recordId, to: null },
            name: { from: row.name, to: null },
            storageKey: { from: row.storageKey, to: null },
          },
        });
        return row;
      });
      try {
        await storage.delete(removed.storageKey);
      } catch {
        // The database is the truth; the bucket keeps deleted files recoverable anyway.
      }
    },
  };
}

export type RecordDocumentService = ReturnType<typeof createRecordDocumentService>;
