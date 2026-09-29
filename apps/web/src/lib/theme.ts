const query = '(prefers-color-scheme: dark)';

/** Follows the system colour scheme: toggles the `dark` class on <html> now and on every change. */
export function initTheme(root: HTMLElement = document.documentElement): () => void {
  const media = window.matchMedia(query);
  const apply = () => root.classList.toggle('dark', media.matches);
  apply();
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}
