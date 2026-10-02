import { describe, expect, it } from 'vitest';
import { classifyFile, defaultDocumentName, documentAccept, fileProblem, imageAccept } from '../src/features/service-records/document-files.ts';

const file = (name: string, type = '', size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('classifyFile', () => {
  it('knows the allowed documents by type', () => {
    expect(classifyFile(file('a.pdf', 'application/pdf'))).toEqual({ kind: 'file', contentType: 'application/pdf' });
    expect(classifyFile(file('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toEqual({
      kind: 'file',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('falls back to the extension when the system gave the file no type', () => {
    expect(classifyFile(file('Protokol.PDF'))).toEqual({ kind: 'file', contentType: 'application/pdf' });
    expect(classifyFile(file('tabulka.xls'))).toEqual({ kind: 'file', contentType: 'application/vnd.ms-excel' });
    expect(classifyFile(file('dopis.docx'))).toEqual({
      kind: 'file',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('turns every picture into an image to shrink, whatever its format', () => {
    for (const f of [file('a.jpg', 'image/jpeg'), file('b.HEIC', 'image/heic'), file('c.jpeg'), file('d.png'), file('e.avif')]) {
      expect(classifyFile(f)).toEqual({ kind: 'image' });
    }
  });

  it('refuses everything else, including a type that merely looks harmless', () => {
    for (const f of [file('a.zip', 'application/zip'), file('b.exe'), file('c.html', 'text/html'), file('noextension'), file('d.pdf.exe', 'application/pdf-fake')]) {
      expect(classifyFile(f)).toBeNull();
    }
  });
});

describe('fileProblem', () => {
  it('flags a type that cannot be attached and a document over 20 MB, but not a big picture', () => {
    expect(fileProblem(file('a.zip', 'application/zip'))).toBe('document_type_not_allowed');
    expect(fileProblem(file('a.pdf', 'application/pdf', 21 * 1024 * 1024))).toBe('document_too_large');
    expect(fileProblem(file('a.pdf', 'application/pdf', 20 * 1024 * 1024))).toBeNull();
    // A photo of 30 MB is shrunk before upload.
    expect(fileProblem(file('a.jpg', 'image/jpeg', 30 * 1024 * 1024))).toBeNull();
  });
});

describe('defaultDocumentName', () => {
  it('is the file name without its extension, at most 200 characters', () => {
    expect(defaultDocumentName(file('revize 2026.pdf'))).toBe('revize 2026');
    expect(defaultDocumentName(file('archiv.tar.gz'))).toBe('archiv.tar');
    expect(defaultDocumentName(file('.hidden'))).toBe('.hidden');
    expect(defaultDocumentName(file(`${'x'.repeat(300)}.pdf`))).toHaveLength(200);
  });
});

describe('picker accept lists', () => {
  it('list types and extensions, and the camera only offers pictures the server takes', () => {
    expect(documentAccept).toContain('application/pdf');
    expect(documentAccept).toContain('.xlsx');
    expect(imageAccept.split(',').sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});
