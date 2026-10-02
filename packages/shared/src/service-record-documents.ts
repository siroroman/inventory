import { z } from 'zod';
import { requiredText, timestamp } from './fields.ts';
import { versionField } from './http.ts';

/**
 * Files that can be attached to a service record, with the extension their storage key gets. The
 * list is also in the `service_record_documents_content_type_allowed` CHECK; a test keeps the two
 * in step. Camera photos arrive as JPEG, so HEIC is not on it.
 */
export const DOCUMENT_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;
export type DocumentContentType = keyof typeof DOCUMENT_TYPES;
export const DOCUMENT_CONTENT_TYPES = Object.keys(DOCUMENT_TYPES) as DocumentContentType[];

export const isDocumentType = (type: string): type is DocumentContentType => Object.hasOwn(DOCUMENT_TYPES, type);

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Who added a document; `null` for one without a recorded author. */
const documentAuthor = z.object({ id: z.uuid(), name: z.string() }).nullable();

/**
 * A document of a service record. `url` opens the file in the browser and `downloadUrl` saves it;
 * both expire after 15 minutes and carry `name` (with the extension) as the file name.
 */
export const documentSchema = z.object({
  id: z.uuid(),
  version: versionField,
  name: requiredText(200),
  contentType: z.string(),
  size: z.number().int().min(1),
  url: z.string(),
  downloadUrl: z.string(),
  createdAt: timestamp,
  createdBy: documentAuthor,
});
export type DocumentDto = z.infer<typeof documentSchema>;

/** Newest first. A record has a handful of documents, so the list is not paged. */
export const documentListSchema = z.array(documentSchema);

/**
 * Step one of adding a document. The type and size are checked by the service, not here, so the
 * SPA gets `document_type_not_allowed` / `document_too_large` rather than a generic validation
 * error. `size` is the file's byte size; the upload link only accepts a file of at most that size.
 */
export const requestDocumentUploadBody = z.strictObject({
  contentType: z.string().trim().min(1).max(150),
  size: z.number().int().min(1).max(1_000_000_000),
});
export type RequestDocumentUploadBody = z.infer<typeof requestDocumentUploadBody>;

/** Step two: the file is uploaded; `name` is what the list shows (the SPA starts from the file name). */
export const confirmDocumentBody = z.strictObject({
  key: z.string().min(1).max(200),
  name: requiredText(200),
});
export type ConfirmDocumentBody = z.infer<typeof confirmDocumentBody>;

export const renameDocumentBody = z.strictObject({ name: requiredText(200), version: versionField });
export type RenameDocumentBody = z.infer<typeof renameDocumentBody>;

export const documentParams = z.object({ id: z.uuid(), documentId: z.uuid() });
