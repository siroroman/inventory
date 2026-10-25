import { readFileSync } from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, type PDFPage, type PDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildLabelsPdf, type LabelFonts, type LabelItem } from '../src/features/labels/build-pdf.ts';
import { cellOrigin, labelLayout, labelSize } from '../src/features/labels/layout.ts';

const font = (file: string) =>
  new Uint8Array(readFileSync(path.resolve(import.meta.dirname, '../src/features/labels/fonts', file)));
const MM = 72 / 25.4;

let fonts: LabelFonts;
beforeAll(() => {
  fonts = { regular: font('Roboto-Regular.ttf'), bold: font('Roboto-Bold.ttf') };
});

const items = (n: number): LabelItem[] =>
  Array.from({ length: n }, (_, i) => ({ code: `INV-${String(i + 1).padStart(5, '0')}`, name: `Položka č. ${i + 1}` }));

/** The decoded content stream of a page. */
function contentOf(doc: PDFDocument, page: PDFPage): string {
  const entry = page.node.Contents();
  const streams = entry instanceof PDFArray ? entry.asArray().map((ref) => doc.context.lookup(ref)) : [entry];
  return streams
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream as PDFRawStream).decode()))
    .join('\n');
}

/** Positions of every text line (`x y Tm`) in points, from the bottom left of the page. */
function textPositions(content: string) {
  return [...content.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

type SheetOptions = { items: LabelItem[]; columns: number; rows: number; startPosition: number };

async function build(options: Partial<SheetOptions> = {}) {
  const bytes = await buildLabelsPdf({ items: items(4), columns: 3, rows: 8, startPosition: 1, fonts, ...options });
  const doc = await PDFDocument.load(bytes);
  return { bytes, doc, pages: doc.getPages() };
}

describe('buildLabelsPdf', () => {
  it('makes a PDF file of A4 portrait pages', async () => {
    const { bytes, pages } = await build();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(pages).toHaveLength(1);
    expect(pages[0]!.getWidth()).toBeCloseTo(210 * MM, 1);
    expect(pages[0]!.getHeight()).toBeCloseTo(297 * MM, 1);
  });

  it('adds a sheet when the labels run over: 118 labels on 3 x 8 are 5 sheets', async () => {
    const { pages } = await build({ items: items(118) });
    expect(pages).toHaveLength(5);
  });

  it('counts the places before the start position as used', async () => {
    // 24 labels from place 6 need two sheets; from place 1 only one.
    expect((await build({ items: items(24), startPosition: 6 })).pages).toHaveLength(2);
    expect((await build({ items: items(24), startPosition: 1 })).pages).toHaveLength(1);
  });

  it('puts every label in its cell, the first at the start position', async () => {
    const grid = { columns: 3, rows: 8 };
    const layout = labelLayout(labelSize(grid));
    const { doc, pages } = await build({ items: items(2), startPosition: 5 });
    const positions = textPositions(contentOf(doc, pages[0]!));
    // Place 5 is row 2, column 2 (counting from 1); the first line is the ID of the first label.
    const cell = cellOrigin(grid, 1, 1);
    expect(positions[0]!.x).toBeCloseTo((cell.x + layout.text.x) * MM, 1);
    expect(positions[0]!.y).toBeLessThan((297 - cell.y) * MM);
    expect(positions[0]!.y).toBeGreaterThan((297 - cell.y - labelSize(grid).height) * MM);
    // The second label is in the next column of that row.
    const next = cellOrigin(grid, 1, 2);
    expect(positions.some((p) => Math.abs(p.x - (next.x + layout.text.x) * MM) < 0.1)).toBe(true);
    // Nothing was drawn above the used places: no text in the first row of cells.
    const firstRowBottom = (297 - cellOrigin(grid, 1, 0).y) * MM;
    expect(positions.every((p) => p.y < firstRowBottom)).toBe(true);
  });

  it('draws one QR path and an ID line per label, plus the name lines', async () => {
    const { doc, pages } = await build({ items: items(3) });
    const content = contentOf(doc, pages[0]!);
    expect(content.match(/\bf\*?\s/g)).toHaveLength(3);
    expect(textPositions(content)).toHaveLength(6);
  });

  it('writes Czech letters with embedded fonts, as subsets', async () => {
    const { bytes, doc } = await build({ items: [{ code: 'INV-1', name: 'Čistička ďábelská, ťuknutí' }] });
    const fontNames = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter((object): object is PDFDict => object instanceof PDFDict && object.get(PDFName.of('Subtype')) === PDFName.of('Type0'))
      .map((dict) => String(dict.get(PDFName.of('BaseFont'))));
    expect(fontNames.filter((name) => /^\/Roboto-(Regular|Bold)/.test(name))).toHaveLength(2);
    // Each font file is 160 KB; the PDF holds only the glyphs it uses.
    expect(bytes.length).toBeLessThan(30_000);
  });

  it('refuses a grid, a start position or an empty list that makes no sense', async () => {
    const base = { items: items(1), columns: 3, rows: 8, startPosition: 1, fonts };
    await expect(buildLabelsPdf({ ...base, columns: 0 })).rejects.toThrow(RangeError);
    await expect(buildLabelsPdf({ ...base, columns: 7 })).rejects.toThrow(RangeError);
    await expect(buildLabelsPdf({ ...base, rows: 17 })).rejects.toThrow(RangeError);
    await expect(buildLabelsPdf({ ...base, rows: 2.5 })).rejects.toThrow(RangeError);
    await expect(buildLabelsPdf({ ...base, startPosition: 25 })).rejects.toThrow(RangeError);
    await expect(buildLabelsPdf({ ...base, startPosition: 0 })).rejects.toThrow(RangeError);
    await expect(buildLabelsPdf({ ...base, items: [] })).rejects.toThrow(RangeError);
  });

  it('makes sheets of the extremes: 6 x 16 and 1 x 1', async () => {
    expect((await build({ items: items(97), columns: 6, rows: 16 })).pages).toHaveLength(2);
    expect((await build({ items: items(3), columns: 1, rows: 1 })).pages).toHaveLength(3);
  });
});

describe('buildLabelsPdf for a label printer', () => {
  const tape = { format: 'tape', width: 50, height: 24 } as const;
  const buildTape = async (options: { items?: LabelItem[]; width?: number; height?: number } = {}) => {
    const bytes = await buildLabelsPdf({ items: items(3), fonts, ...tape, ...options });
    const doc = await PDFDocument.load(bytes);
    return { doc, pages: doc.getPages() };
  };

  it('makes one page of the label size for every label', async () => {
    const { pages } = await buildTape({ items: items(3) });
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page.getWidth()).toBeCloseTo(50 * MM, 1);
      expect(page.getHeight()).toBeCloseTo(24 * MM, 1);
    }
  });

  it('draws the label from the corner of its page: one QR path, the ID and the name', async () => {
    const size = { width: 50, height: 24 };
    const layout = labelLayout(size);
    const { doc, pages } = await buildTape({ items: items(1) });
    const content = contentOf(doc, pages[0]!);
    expect(content.match(/\bf\*?\s/g)).toHaveLength(1);
    const positions = textPositions(content);
    expect(positions.length).toBeGreaterThanOrEqual(2);
    expect(positions[0]!.x).toBeCloseTo(layout.text.x * MM, 1);
    // Every line sits inside the page.
    expect(positions.every((p) => p.y > 0 && p.y < 24 * MM)).toBe(true);
  });

  it('refuses a size outside 10 to 100 mm and an empty list', async () => {
    await expect(buildTape({ width: 9 })).rejects.toThrow(RangeError);
    await expect(buildTape({ height: 101 })).rejects.toThrow(RangeError);
    await expect(buildTape({ width: Number.NaN })).rejects.toThrow(RangeError);
    await expect(buildTape({ items: [] })).rejects.toThrow(RangeError);
    expect((await buildTape({ width: 10, height: 100 })).pages).toHaveLength(3);
  });
});

describe('the label fonts', () => {
  it('have every letter a Czech name can have, and the ellipsis', () => {
    for (const file of ['Roboto-Regular.ttf', 'Roboto-Bold.ttf']) {
      const f = fontkit.create(font(file)) as unknown as { hasGlyphForCodePoint(codePoint: number): boolean };
      const missing = [...'ěščřžýáíéúůďťňĚŠČŘŽÝÁÍÉÚŮĎŤŇóÓäöüß…–/-.,()0123456789'].filter(
        (char) => !f.hasGlyphForCodePoint(char.codePointAt(0)!),
      );
      expect(missing, file).toEqual([]);
    }
  });
});
