import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import type { Measure } from './fit-text.ts';
import { planLabel } from './label-plan.ts';
import {
  cellOrigin,
  type Grid,
  isValidStartPosition,
  isValidTapeSize,
  labelSize,
  MAX_COLUMNS,
  MAX_LABEL_MM,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_LABEL_MM,
  MIN_ROWS,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  pageCount,
  placement,
  QUIET_MODULES,
  type Size,
} from './layout.ts';
import { qrModules, qrPath } from './qr.ts';

const PT_PER_MM = 72 / 25.4;
const BLACK = rgb(0, 0, 0);

/** What a label needs of an item: the QR code holds `code` (the item's ID) and the text shows both. */
export type LabelItem = { code: string; name: string };
/** TrueType files of a sans with Czech letters: regular for the name, bold for the ID. */
export type LabelFonts = { regular: Uint8Array; bold: Uint8Array };

type SheetOptions = {
  format?: 'sheet';
  columns: number;
  rows: number;
  /** The first free place of a partly used sheet, from 1, left to right, top to bottom. */
  startPosition: number;
};
/** A label printer: every page is one label of this size, in millimetres. */
type TapeOptions = { format: 'tape'; width: number; height: number };

export type LabelsPdfOptions = { items: LabelItem[]; fonts: LabelFonts } & (SheetOptions | TapeOptions);

const pt = (mm: number) => mm * PT_PER_MM;

/** Where a label sits on its page and how big the page is, for converting millimetres to PDF points. */
type Frame = { origin: { x: number; y: number }; size: Size; pageHeight: number };

function drawLabel(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, measure: Measure, item: LabelItem, frame: Frame) {
  const { origin, pageHeight } = frame;
  // Millimetres from the top of the page as a PDF y (from the bottom, in points).
  const pdfY = (mmFromTop: number) => pt(pageHeight - mmFromTop);
  const plan = planLabel(measure, item, frame.size);

  if (plan.qr.width > 0) {
    const modules = qrModules(item.code);
    const modulePt = pt(plan.qr.width) / (modules.length + 2 * QUIET_MODULES);
    page.drawSvgPath(qrPath(modules, modulePt), {
      x: pt(origin.x + plan.qr.x) + QUIET_MODULES * modulePt,
      y: pdfY(origin.y + plan.qr.y) - QUIET_MODULES * modulePt,
      color: BLACK,
      borderWidth: 0,
    });
  }
  for (const line of plan.lines) {
    page.drawText(line.text, {
      x: pt(origin.x + line.x),
      y: pdfY(origin.y + line.baseline),
      size: line.size,
      font: line.bold ? fonts.bold : fonts.regular,
      color: BLACK,
    });
  }
}

function checkSheet({ columns, rows, startPosition }: SheetOptions): Grid {
  const grid = { columns, rows };
  if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    throw new RangeError(`columns must be ${MIN_COLUMNS} to ${MAX_COLUMNS}`);
  }
  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    throw new RangeError(`rows must be ${MIN_ROWS} to ${MAX_ROWS}`);
  }
  if (!isValidStartPosition(grid, startPosition)) throw new RangeError('startPosition is not a place on the sheet');
  return grid;
}

/**
 * A PDF of QR labels. For an A4 printer (the default) the pages are A4 portrait with `columns` x
 * `rows` labels inside a 5 mm margin, the first at `startPosition`. For a label printer
 * (`format: 'tape'`) every page is one label of `width` x `height` mm, which the printer's app
 * prints as it is. Black on white, vector QR codes with error correction Q, the fonts embedded as
 * subsets. Runs in the browser and in Node (the unit tests).
 */
export async function buildLabelsPdf(options: LabelsPdfOptions): Promise<Uint8Array> {
  const { items, fonts } = options;
  const tape: Size | null = options.format === 'tape' ? { width: options.width, height: options.height } : null;
  if (tape && !isValidTapeSize(tape)) {
    throw new RangeError(`a label must be ${MIN_LABEL_MM} to ${MAX_LABEL_MM} mm on each side`);
  }
  const sheet = options.format === 'tape' ? null : { grid: checkSheet(options), startPosition: options.startPosition };
  if (items.length === 0) throw new RangeError('there are no labels to make');

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    doc.embedFont(fonts.regular, { subset: true }),
    doc.embedFont(fonts.bold, { subset: true }),
  ]);
  const measure: Measure = (text, size, isBold) => (isBold ? bold : regular).widthOfTextAtSize(text, size);
  const usedFonts = { regular, bold };

  if (tape) {
    for (const item of items) {
      const page = doc.addPage([pt(tape.width), pt(tape.height)]);
      drawLabel(page, usedFonts, measure, item, { origin: { x: 0, y: 0 }, size: tape, pageHeight: tape.height });
    }
  } else if (sheet) {
    const { grid, startPosition } = sheet;
    const pages = Array.from({ length: pageCount(grid, startPosition, items.length) }, () =>
      doc.addPage([pt(PAGE_WIDTH_MM), pt(PAGE_HEIGHT_MM)]),
    );
    items.forEach((item, index) => {
      const { page, row, column } = placement(grid, startPosition, index);
      const origin = cellOrigin(grid, row, column);
      drawLabel(pages[page]!, usedFonts, measure, item, { origin, size: labelSize(grid), pageHeight: PAGE_HEIGHT_MM });
    });
  }
  return doc.save();
}
