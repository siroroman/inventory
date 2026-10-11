import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import { type Measure, fitLabelText, LINE_HEIGHT, textHeightMm } from './fit-text.ts';
import {
  cellOrigin,
  type Grid,
  isValidStartPosition,
  labelLayout,
  labelSize,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  pageCount,
  placement,
  QUIET_MODULES,
} from './layout.ts';
import { qrModules } from './qr.ts';

const PT_PER_MM = 72 / 25.4;
const BLACK = rgb(0, 0, 0);
/** Where the baseline of a line sits below the top of its line box, in em (Roboto's ascent). */
const BASELINE = 0.94;

/** What a label needs of an item: the QR code holds `code` (the item's ID) and the text shows both. */
export type LabelItem = { code: string; name: string };
/** TrueType files of a sans with Czech letters: regular for the name, bold for the ID. */
export type LabelFonts = { regular: Uint8Array; bold: Uint8Array };

export type LabelsPdfOptions = {
  items: LabelItem[];
  columns: number;
  rows: number;
  /** The first free place of a partly used sheet, from 1, left to right, top to bottom. */
  startPosition: number;
  fonts: LabelFonts;
};

const pt = (mm: number) => mm * PT_PER_MM;
/** Millimetres from the top of the page as a PDF y (from the bottom, in points). */
const pdfY = (mmFromTop: number) => pt(PAGE_HEIGHT_MM - mmFromTop);

/** The dark modules of the QR code as one filled path (no hairlines between modules), in points. */
function qrPath(modules: boolean[][], modulePt: number): string {
  const f = (n: number) => Number(n.toFixed(3));
  const parts: string[] = [];
  modules.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      parts.push(`M${f(start * modulePt)} ${f(r * modulePt)}h${f((c - start) * modulePt)}v${f(modulePt)}h${f(-(c - start) * modulePt)}z`);
    }
  });
  return parts.join('');
}

function drawLabel(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  measure: Measure,
  item: LabelItem,
  grid: Grid,
  at: { row: number; column: number },
) {
  const origin = cellOrigin(grid, at.row, at.column);
  const layout = labelLayout(labelSize(grid));

  if (layout.qr.width > 0) {
    const modules = qrModules(item.code);
    const modulePt = pt(layout.qr.width) / (modules.length + 2 * QUIET_MODULES);
    page.drawSvgPath(qrPath(modules, modulePt), {
      x: pt(origin.x + layout.qr.x) + QUIET_MODULES * modulePt,
      y: pdfY(origin.y + layout.qr.y) - QUIET_MODULES * modulePt,
      color: BLACK,
      borderWidth: 0,
    });
  }

  const text = fitLabelText(measure, { id: item.code, name: item.name }, layout.text);
  // Centred in its box, but never above it.
  let top = origin.y + layout.text.y + Math.max(0, (layout.text.height - textHeightMm(text)) / 2);
  const x = pt(origin.x + layout.text.x);
  const lines = [
    ...text.idLines.map((line) => ({ line, size: text.idSize, font: fonts.bold })),
    ...text.nameLines.map((line) => ({ line, size: text.nameSize, font: fonts.regular })),
  ];
  for (const { line, size, font } of lines) {
    page.drawText(line, { x, y: pdfY(top) - BASELINE * size, size, font, color: BLACK });
    top += (size * LINE_HEIGHT) / PT_PER_MM;
  }
}

/**
 * An A4 portrait PDF of QR labels, `columns` x `rows` to a sheet inside a 5 mm margin, the first
 * label at `startPosition`. Black on white, vector QR codes with error correction Q, the fonts
 * embedded as subsets. Runs in the browser and in Node (the unit tests).
 */
export async function buildLabelsPdf({ items, columns, rows, startPosition, fonts }: LabelsPdfOptions): Promise<Uint8Array> {
  const grid = { columns, rows };
  if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    throw new RangeError(`columns must be ${MIN_COLUMNS} to ${MAX_COLUMNS}`);
  }
  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    throw new RangeError(`rows must be ${MIN_ROWS} to ${MAX_ROWS}`);
  }
  if (!isValidStartPosition(grid, startPosition)) throw new RangeError('startPosition is not a place on the sheet');
  if (items.length === 0) throw new RangeError('there are no labels to make');

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    doc.embedFont(fonts.regular, { subset: true }),
    doc.embedFont(fonts.bold, { subset: true }),
  ]);
  const measure: Measure = (text, size, isBold) => (isBold ? bold : regular).widthOfTextAtSize(text, size);

  const pages = Array.from({ length: pageCount(grid, startPosition, items.length) }, () =>
    doc.addPage([pt(PAGE_WIDTH_MM), pt(PAGE_HEIGHT_MM)]),
  );
  items.forEach((item, index) => {
    const { page, row, column } = placement(grid, startPosition, index);
    drawLabel(pages[page]!, { regular, bold }, measure, item, grid, { row, column });
  });
  return doc.save();
}
