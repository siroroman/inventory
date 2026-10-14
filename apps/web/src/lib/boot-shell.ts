/**
 * Removes the loading shell of index.html (`#boot`) once the router has made its first load and the
 * app has something to show (a screen, the login form, or an error). Until then the shell fills
 * the time the scripts and the session check take, instead of a white page.
 */
export function removeBootShellWhenReady(
  router: { subscribe: (event: 'onResolved', listener: () => void) => () => void },
  doc: Document = document,
): void {
  const unsubscribe = router.subscribe('onResolved', () => {
    doc.getElementById('boot')?.remove();
    unsubscribe();
  });
}
