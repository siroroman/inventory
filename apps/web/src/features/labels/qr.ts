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
