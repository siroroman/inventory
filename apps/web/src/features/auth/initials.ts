/** First character of a word; spreads to code points so an emoji or rare letter is not cut in half. */
const firstLetter = (word: string | undefined) => [...(word ?? '')][0] ?? '';

/** Up to two capital letters for the avatar: first letters of the first and last word of the name. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? firstLetter(words[words.length - 1]) : '';
  return (firstLetter(words[0]) + last || firstLetter(email)).toLocaleUpperCase('cs');
}
