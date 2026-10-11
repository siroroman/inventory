/** `stitky-<LOC code>-<yyyy-mm-dd>.pdf`, with the date of the user's own day. */
export function pdfFileName(locationCode: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `stitky-${locationCode}-${day}.pdf`;
}

/** An installed iOS web app, where a blob download may open the PDF in the viewer instead of saving it. */
function isIosStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Hands the PDF to the user: a download under `name`. In an installed iOS app it opens in a new tab,
 * where the share sheet can save it (the `download` attribute is not honoured there).
 */
export function savePdf(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  if (isIosStandalone()) {
    window.open(url, '_blank');
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  }
  // The browser has taken what it needs by then; a PDF must not stay in memory for the session.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
