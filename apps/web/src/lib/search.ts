/** Lower case without diacritics, so "zebrik" finds "Žebřík": what the server's search does for the lists. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Whether every word of `q` occurs in at least one of the texts, ignoring case and diacritics.
 * For lists that are already in the browser; the paged lists are searched by the API.
 */
export function matchesWords(texts: string[], q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.map(fold);
  return words.every((word) => haystack.some((text) => text.includes(word)));
}
