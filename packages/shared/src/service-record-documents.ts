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
