import { DOCUMENT_CONTENT_TYPES, DOCUMENT_TYPES, type DocumentContentType, isDocumentType, MAX_DOCUMENT_BYTES } from '@inventory/shared';
import type { ErrorCode } from '@inventory/shared';

/** For the file picker: the allowed types and extensions. Listing the image types (not `image/*`) makes iOS hand over HEIC photos as JPEG. */
export const documentAccept = [...DOCUMENT_CONTENT_TYPES, ...Object.values(DOCUMENT_TYPES).map((ext) => `.${ext}`)].join(',');
export const imageAccept = DOCUMENT_CONTENT_TYPES.filter((type) => type.startsWith('image/')).join(',');

const typeByExtension = new Map<string, DocumentContentType>(
  (Object.entries(DOCUMENT_TYPES) as [DocumentContentType, string][]).map(([type, extension]) => [extension, type]),
);
// jpeg, the other spelling of jpg
typeByExtension.set('jpeg', 'image/jpeg');

const extensionOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/** Any picture, whatever its format: the browser turns it into a JPEG before upload (or fails, and the user is told). */
const isPicture = (file: File) => file.type.startsWith('image/') || /^(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/.test(extensionOf(file.name));

export type FileKind = { kind: 'image' } | { kind: 'file'; contentType: DocumentContentType };

/** What to do with a picked file, or null when its type cannot be attached. Extensions are consulted because some systems give Word and Excel files no type. */
export function classifyFile(file: File): FileKind | null {
  if (isPicture(file)) return { kind: 'image' };
  const contentType = isDocumentType(file.type) ? file.type : typeByExtension.get(extensionOf(file.name));
  return contentType ? { kind: 'file', contentType } : null;
}

/** A reason to refuse a picked file before uploading it, as an API error code the SPA has a text for. */
export function fileProblem(file: File): ErrorCode | null {
  const kind = classifyFile(file);
  if (!kind) return 'document_type_not_allowed';
  // Pictures are shrunk first, so only the other files can be too big as they are.
  if (kind.kind === 'file' && file.size > MAX_DOCUMENT_BYTES) return 'document_too_large';
  return null;
}

/** The name a document starts with: the file's own name without its extension. */
export function defaultDocumentName(file: File): string {
  const dot = file.name.lastIndexOf('.');
  const name = (dot > 0 ? file.name.slice(0, dot) : file.name).trim();
  return name.slice(0, 200);
}
