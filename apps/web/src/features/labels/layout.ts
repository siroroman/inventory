// The geometry of a sheet of labels (SPEC §9.4.12), in millimetres from the top left of the page.
// Pure functions: the wizard's preview and the PDF builder both read it, so they cannot disagree.

export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;
/** The fixed margin round the grid; the labels have no gaps between them. */
export const PAGE_MARGIN_MM = 5;
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const MIN_ROWS = 1;
export const MAX_ROWS = 16;
export const DEFAULT_COLUMNS = 3;
export const DEFAULT_ROWS = 8;

/** Inside every label, so the print stays clear of the edge of the sticker. */
export const INNER_MARGIN_MM = 3;
/** The empty border of a QR code, in modules (the standard asks for 4). */
export const QUIET_MODULES = 4;
/** Below this side of the QR code a phone camera has a hard time. */
export const MIN_QR_SIDE_MM = 15;
/** A label whose width is under this many times its height is "portrait-ish": QR on top, text below. */
export const STACKED_RATIO = 1.3;
/** Room the ID and two lines of the name need under the QR code of a stacked label. */
const STACKED_TEXT_MM = 11;
/** Between the QR code and the text beside it. */
const GAP_MM = 2;

export type Grid = { columns: number; rows: number };
export type Size = { width: number; height: number };
export type Box = { x: number; y: number; width: number; height: number };

/** Size of one label: the page inside its margin, shared out evenly. */
export function labelSize({ columns, rows }: Grid): Size {
  return {
    width: (PAGE_WIDTH_MM - 2 * PAGE_MARGIN_MM) / columns,
    height: (PAGE_HEIGHT_MM - 2 * PAGE_MARGIN_MM) / rows,
  };
}

export const slotsPerPage = ({ columns, rows }: Grid) => columns * rows;

/** `startPosition` is 1-based, left to right, top to bottom, on the first sheet. */
export function isValidStartPosition(grid: Grid, startPosition: number): boolean {
  return Number.isInteger(startPosition) && startPosition >= 1 && startPosition <= slotsPerPage(grid);
}

/** Where the `index`-th label (from 0) goes: its sheet (from 0), row and column. */
export function placement(grid: Grid, startPosition: number, index: number) {
  const slot = startPosition - 1 + index;
  const perPage = slotsPerPage(grid);
  const inPage = slot % perPage;
  return { page: Math.floor(slot / perPage), row: Math.floor(inPage / grid.columns), column: inPage % grid.columns };
}

/** Top left corner of a cell of the grid on the page. */
export function cellOrigin(grid: Grid, row: number, column: number) {
  const { width, height } = labelSize(grid);
  return { x: PAGE_MARGIN_MM + column * width, y: PAGE_MARGIN_MM + row * height };
}

export function pageCount(grid: Grid, startPosition: number, labels: number): number {
  return labels === 0 ? 0 : Math.ceil((startPosition - 1 + labels) / slotsPerPage(grid));
}

/** The places left empty on the last sheet. */
export function emptyOnLastPage(grid: Grid, startPosition: number, labels: number): number {
  const used = (startPosition - 1 + labels) % slotsPerPage(grid);
  return used === 0 ? 0 : slotsPerPage(grid) - used;
}

/**
 * What goes where inside a label of this size: the QR code (its side includes the quiet zone) and
 * the box for the ID and the name. Landscape: QR on the left, text on the right. Portrait-ish: QR
 * on top, centred, text below.
 */
export function labelLayout({ width, height }: Size): { stacked: boolean; qr: Box; text: Box } {
  const inner = INNER_MARGIN_MM;
  if (width < STACKED_RATIO * height) {
    const side = Math.max(0, Math.min(width - 2 * inner, height - 2 * inner - STACKED_TEXT_MM));
    const textTop = inner + side + (side > 0 ? GAP_MM / 2 : 0);
    return {
      stacked: true,
      qr: { x: (width - side) / 2, y: inner, width: side, height: side },
      text: { x: inner, y: textTop, width: width - 2 * inner, height: height - inner - textTop },
    };
  }
  const side = Math.max(0, Math.min(height - 2 * inner, width - 2 * inner));
  const textX = inner + side + GAP_MM;
  return {
    stacked: false,
    qr: { x: inner, y: inner, width: side, height: side },
    text: { x: textX, y: inner, width: Math.max(0, width - inner - textX), height: height - 2 * inner },
  };
}

/** The side of the QR code of a label of this grid, for the "too small" warning. */
export function qrSide(grid: Grid): number {
  return labelLayout(labelSize(grid)).qr.width;
}

export const isQrTooSmall = (grid: Grid) => qrSide(grid) < MIN_QR_SIDE_MM;
