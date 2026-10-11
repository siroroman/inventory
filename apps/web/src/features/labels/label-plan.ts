import { fitLabelText, LINE_HEIGHT, MM_PER_PT, type Measure, textHeightMm } from './fit-text.ts';
import { type Box, labelLayout, type Size } from './layout.ts';

/** Where the baseline of a line sits below the top of its line box, in em (Roboto's ascent). */
const BASELINE = 0.94;

export type PlannedLine = {
  text: string;
  /** Points. */
  size: number;
  bold: boolean;
  /** Millimetres from the left of the label, and from its top to the baseline. */
  x: number;
  baseline: number;
};

export type LabelPlan = { qr: Box; lines: PlannedLine[] };

/**
 * Everything on one label, in millimetres from its top left corner: the box of the QR code (its
 * side includes the quiet zone) and each line of text with its baseline. The PDF draws it and the
 * wizard's preview shows it, so the two cannot disagree.
 */
export function planLabel(measure: Measure, item: { code: string; name: string }, size: Size): LabelPlan {
  const layout = labelLayout(size);
  const text = fitLabelText(measure, { id: item.code, name: item.name }, layout.text);
  // Centred in its box, but never above it.
  let top = layout.text.y + Math.max(0, (layout.text.height - textHeightMm(text)) / 2);
  const lines: PlannedLine[] = [];
  const put = (line: string, sizePt: number, bold: boolean) => {
    lines.push({ text: line, size: sizePt, bold, x: layout.text.x, baseline: top + BASELINE * sizePt * MM_PER_PT });
    top += sizePt * LINE_HEIGHT * MM_PER_PT;
  };
  for (const line of text.idLines) put(line, text.idSize, true);
  for (const line of text.nameLines) put(line, text.nameSize, false);
  return { qr: layout.qr, lines };
}
