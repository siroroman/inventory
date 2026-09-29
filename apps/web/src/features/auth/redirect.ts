/**
 * Where to go after signing in. `?redirect=` comes from the address bar, so only a path on this
 * site is accepted: it must start with a single `/` and contain no backslash or control
 * character (browsers read `\` as `/` and drop tabs and newlines, which would turn `/\evil.com`
 * or `/<TAB>/evil.com` into a link to another site). Anything else, and the login page itself,
 * leads home.
 */
export function safeRedirect(value: string | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\\\u0000- \u007f]/.test(value)) return '/';
  const path = value.split(/[?#]/, 1)[0];
  return path === '/login' ? '/' : value;
}
