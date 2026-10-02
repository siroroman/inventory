import type { DocumentDto } from '@inventory/shared';
import type { RecordDocumentWithUrl } from './service.ts';

/** The storage key stays inside the API; the browser only ever sees the signed URL. */
export function toDocumentDto(document: RecordDocumentWithUrl): DocumentDto {
  return {
    id: document.id,
    version: document.version,
    name: document.name,
    contentType: document.contentType,
    size: document.sizeBytes,
    url: document.url,
    downloadUrl: document.downloadUrl,
    createdAt: document.createdAt.toISOString(),
    createdBy: document.createdBy ? { id: document.createdBy, name: document.createdByName ?? '' } : null,
  };
}
