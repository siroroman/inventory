// What a label says and how big (SPEC §9.4.12): the ID in bold on one line, 11 pt shrinking to 8 pt,
// then the name in up to two lines with an ellipsis. Nothing below 8 pt. It works on a `measure`
// callback so the PDF (real font metrics) and any preview share the rules.

export const ID_MAX_PT = 11;
export const MIN_PT = 8;
export const NAME_PT = 9;
export const MAX_NAME_LINES = 2;
const LINE_HEIGHT = 1.2;
const MM_PER_PT = 25.4 / 72;
const ELLIPSIS = '…';

/** The width of `text` in points at `sizePt`. */
export type Measure = (text: string, sizePt: number, bold: boolean) => number;

export type LabelText = {
  /** One line, or the ID cut into pieces when it does not fit even at 8 pt (it is never abbreviated). */
  idLines: string[];
  idSize: number;
  nameLines: string[];
  nameSize: number;
};

const mm = (pt: number) => pt * MM_PER_PT;

/** Splits `text` into pieces that each fit, at any character. */
function breakLongText(text: string, fits: (candidate: string) => boolean): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const char of text) {
    if (current && !fits(current + char)) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** The longest start of `text` that, with an ellipsis, fits. */
function withEllipsis(text: string, fits: (candidate: string) => boolean): string {
  if (fits(text)) return text;
  let kept = text.trimEnd();
  while (kept && !fits(kept + ELLIPSIS)) kept = kept.slice(0, -1).trimEnd();
  return kept + ELLIPSIS;
}

/** Greedy word wrap to `maxLines`; what does not fit is cut at the end of the last line with an ellipsis. */
export function wrapName(name: string, maxLines: number, fits: (candidate: string) => boolean): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (fits(next)) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    // A word wider than the whole line is cut with an ellipsis rather than split in the middle.
    current = withEllipsis(word, fits);
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  // The rest of the name follows the last kept line, so the ellipsis stands for it.
  const rest = lines.slice(maxLines - 1).join(' ');
  kept[maxLines - 1] = withEllipsis(rest, fits);
  return kept;
}

/**
 * Splits an ID that does not fit on one line: after hyphens where it can ("INV-73-" / "2023016"),
 * in the middle of a piece only when that piece alone is too wide. Nothing is dropped.
 */
export function breakId(id: string, fits: (candidate: string) => boolean): string[] {
  const lines: string[] = [];
  let current = '';
  for (const piece of id.split(/(?<=-)/)) {
    if (current && fits(current + piece)) {
      current += piece;
      continue;
    }
    if (current) lines.push(current);
    if (fits(piece)) {
      current = piece;
    } else {
      const parts = breakLongText(piece, fits);
      current = parts.pop() ?? '';
      lines.push(...parts);
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Lays the ID and the name out in a box of `widthMm` x `heightMm`. The ID gets the largest size from
 * 11 pt down to 8 pt that fits on one line; the name takes the lines that are left, at most two.
 */
export function fitLabelText(
  measure: Measure,
  { id, name }: { id: string; name: string },
  { width: widthMm, height: heightMm }: { width: number; height: number },
): LabelText {
  const widthPt = widthMm / MM_PER_PT;
  let idSize = ID_MAX_PT;
  while (idSize > MIN_PT && measure(id, idSize, true) > widthPt) idSize -= 0.5;
  const idLines = measure(id, idSize, true) <= widthPt ? [id] : breakId(id, (c) => measure(c, idSize, true) <= widthPt);

  const nameSize = idSize >= 10 ? NAME_PT : MIN_PT;
  const left = heightMm - idLines.length * mm(idSize * LINE_HEIGHT);
  const room = Math.max(0, Math.min(MAX_NAME_LINES, Math.floor(left / mm(nameSize * LINE_HEIGHT))));
  const nameLines = room === 0 ? [] : wrapName(name, room, (c) => measure(c, nameSize, false) <= widthPt);
  return { idLines, idSize, nameLines, nameSize };
}

/** Height of the laid-out text in mm, for centring it in its box. */
export function textHeightMm(text: LabelText): number {
  return mm(
    text.idLines.length * text.idSize * LINE_HEIGHT + text.nameLines.length * text.nameSize * LINE_HEIGHT,
  );
}

export { LINE_HEIGHT, MM_PER_PT };
