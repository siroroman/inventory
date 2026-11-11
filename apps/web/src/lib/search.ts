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

/**
 * Whether `q` occurs in one of the IDs with spaces ignored as well as case and diacritics, so "S129"
 * finds the electrician's "S 129" and "s 129" finds "S129". False for an empty `q`.
 */
export function matchesId(ids: string[], q: string): boolean {
  const compact = (text: string) => fold(text).replace(/\s+/g, '');
  const needle = compact(q);
  return needle.length > 0 && ids.some((id) => compact(id).includes(needle));
}
