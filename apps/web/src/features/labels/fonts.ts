import boldUrl from './fonts/Roboto-Bold.ttf?url';
import regularUrl from './fonts/Roboto-Regular.ttf?url';
import type { LabelFonts } from './build-pdf.ts';

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The font ${url} did not load (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Roboto Regular and Bold (SIL Open Font License, `fonts/LICENSE.txt`), about 160 KB each. The
 * standard PDF fonts have no ě č ř ů, so the PDF embeds a subset of these. Only fetched when a PDF
 * is made, from the app's own origin.
 */
export async function loadLabelFonts(): Promise<LabelFonts> {
  const [regular, bold] = await Promise.all([fetchBytes(regularUrl), fetchBytes(boldUrl)]);
  return { regular, bold };
}

/** The family name of the preview's copy of the label fonts. */
export const PREVIEW_FONT = 'LabelRoboto';

let previewFonts: Promise<void> | undefined;

/**
 * Makes the same two font files available to the page, so the preview sets its text in the font
 * the PDF embeds and measures it with the same widths. Resolves once; where the browser has no
 * `FontFace` the preview falls back to the system sans and an estimated width.
 */
export function loadPreviewFonts(): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  previewFonts ??= Promise.all([
    new FontFace(PREVIEW_FONT, `url(${regularUrl})`, { weight: '400' }).load(),
    new FontFace(PREVIEW_FONT, `url(${boldUrl})`, { weight: '700' }).load(),
  ]).then((faces) => {
    for (const face of faces) document.fonts.add(face);
  });
  return previewFonts.catch(() => {
    previewFonts = undefined;
  });
}
