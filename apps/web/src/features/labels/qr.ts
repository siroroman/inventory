import qrcode from 'qrcode-generator';

/**
 * The dark modules of the QR code of `text` as rows of booleans (a square, without the quiet
 * zone). Error correction Q, the smallest version that holds the text (SPEC §9.4.12).
 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'Q');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => qr.isDark(row, column)));
}

/**
 * The dark modules as one filled path (no hairlines between modules), each module `unit` wide:
 * points for the PDF, 1 for the preview, which scales it.
 */
export function qrPath(modules: boolean[][], unit: number): string {
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
      parts.push(`M${f(start * unit)} ${f(r * unit)}h${f((c - start) * unit)}v${f(unit)}h${f(-(c - start) * unit)}z`);
    }
  });
  return parts.join('');
}
