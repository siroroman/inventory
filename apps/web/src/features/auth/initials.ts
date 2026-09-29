/** Up to two capital letters for the avatar: first letters of the first and last word of the name. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last || email.charAt(0)).toLocaleUpperCase('cs');
}
