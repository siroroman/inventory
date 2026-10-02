import { describe, expect, it } from 'vitest';
import {
  confirmDocumentBody,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_TYPES,
  isDocumentType,
  MAX_DOCUMENT_BYTES,
  renameDocumentBody,
  requestDocumentUploadBody,
} from '../src/index.ts';

describe('document types', () => {
  it('maps every allowed type to a distinct extension', () => {
    const extensions = Object.values(DOCUMENT_TYPES);
    expect(new Set(extensions).size).toBe(extensions.length);
    expect(DOCUMENT_CONTENT_TYPES).toHaveLength(extensions.length);
  });

  it('recognises allowed types only, not inherited object keys', () => {
    expect(isDocumentType('application/pdf')).toBe(true);
    expect(isDocumentType('image/heic')).toBe(false);
    expect(isDocumentType('toString')).toBe(false);
    expect(isDocumentType('__proto__')).toBe(false);
  });

  it('limits a document to 20 MB', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('document bodies', () => {
  it('lets the service, not the schema, judge type and size, so the SPA gets a specific code', () => {
    expect(requestDocumentUploadBody.safeParse({ contentType: 'image/gif', size: MAX_DOCUMENT_BYTES * 2 }).success).toBe(true);
  });

  it('rejects an empty file, a fractional size and unknown fields', () => {
    for (const body of [{ contentType: 'application/pdf', size: 0 }, { contentType: 'application/pdf', size: 1.5 }, { contentType: 'application/pdf', size: 1, extra: 1 }, { size: 1 }]) {
      expect(requestDocumentUploadBody.safeParse(body).success).toBe(false);
    }
  });

  it('trims names and rejects blank or overlong ones', () => {
    expect(confirmDocumentBody.parse({ key: 'k', name: '  Zpráva  ' }).name).toBe('Zpráva');
    expect(confirmDocumentBody.safeParse({ key: 'k', name: '   ' }).success).toBe(false);
    expect(confirmDocumentBody.safeParse({ key: 'k', name: 'x'.repeat(201) }).success).toBe(false);
    expect(renameDocumentBody.safeParse({ name: 'x', version: 0 }).success).toBe(false);
    expect(renameDocumentBody.parse({ name: ' Nová ', version: 2 })).toEqual({ name: 'Nová', version: 2 });
  });
});
