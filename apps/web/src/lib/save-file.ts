export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/** An installed iOS web app, where a blob download may open the file in a viewer instead of saving it. */
function isIosStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true && isIos();
}

/** The browser has taken what it needs by then; a file must not stay in memory for the session. */
export const KEEP_MS = 60_000;

/**
 * Hands a file made in the browser to the user: a download under `name`. In an installed iOS app it
 * opens in a new tab, where the share sheet can save it (the `download` attribute is not honoured there).
 */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
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
