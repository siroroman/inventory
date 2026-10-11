import type { Measure } from './fit-text.ts';
import { PREVIEW_FONT } from './fonts.ts';

let context: OffscreenCanvasRenderingContext2D | null | undefined;

/**
 * Text width for the preview, in points: measured on a canvas in the label font once it has been
 * loaded (`loadPreviewFonts`), else estimated from the character count. The PDF measures with the
 * embedded font itself, so a small difference between the two is only ever cosmetic.
 */
export const previewMeasure: Measure = (text, size, bold) => {
  if (context === undefined) {
    context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  }
  if (context) {
    // Measured at 100 pt and scaled: a canvas rounds small font sizes.
    context.font = `${bold ? 700 : 400} 100px ${PREVIEW_FONT}, sans-serif`;
    return (context.measureText(text).width * size) / 100;
  }
  return text.length * size * (bold ? 0.6 : 0.55);
};
