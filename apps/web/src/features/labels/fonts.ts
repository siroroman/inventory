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
