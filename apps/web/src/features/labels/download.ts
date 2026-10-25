const MAX_NAME_CHARS = 60;

/**
 * The location's name as part of a file name: what file systems refuse is dropped, runs of white
 * space become one hyphen, and Czech letters stay (every system the app runs on takes them).
 */
function fileNamePart(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, MAX_NAME_CHARS)
    .replace(/^[-.]+|[-.]+$/g, '');
}

/**
 * `stitky-<location name>-<yyyy-mm-dd>.pdf`, with the date of the user's own day. A name that
 * leaves nothing (only characters a file name cannot hold) falls back to the location's ID.
 */
export function pdfFileName(location: { code: string; name: string }, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `stitky-${fileNamePart(location.name) || location.code}-${day}.pdf`;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/** An installed iOS web app, where a blob download may open the PDF in the viewer instead of saving it. */
function isIosStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true && isIos();
}

/** The browser has taken what it needs by then; a PDF must not stay in memory for the session. */
const KEEP_MS = 60_000;
const PRINT_KEEP_MS = 10 * KEEP_MS;

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
  setTimeout(() => URL.revokeObjectURL(url), KEEP_MS);
}

/** Whether the browser can hand a PDF file to another app through the system share sheet. */
export function canSharePdf(): boolean {
  try {
    const probe = new File([], 'stitky.pdf', { type: 'application/pdf' });
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Opens the system share sheet with the PDF, so a label printer's app (Brother iPrint&Label) can take
 * it. Closing the sheet without choosing an app is not a failure: that answers `false`.
 */
export async function sharePdf(bytes: Uint8Array, name: string): Promise<boolean> {
  const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

/**
 * Opens the browser's print dialog for the PDF: it is loaded into a hidden frame and that frame is
 * printed, so nothing leaves the page. iOS cannot print a frame, so there the PDF opens in a new
 * tab, where the share sheet prints it.
 */
export function printPdf(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  if (isIos()) {
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), KEEP_MS);
    return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.addEventListener('load', () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });
  frame.src = url;
  document.body.append(frame);
  // Long enough for the print dialog to be open and the print preview to be drawn from the frame.
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, PRINT_KEEP_MS);
}
