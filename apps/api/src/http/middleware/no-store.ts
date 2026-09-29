import type { MiddlewareHandler } from 'hono';

/**
 * Nothing under /api/v1 may be kept by a browser or proxy cache: the responses are private, and
 * photo URLs in them are signed and short-lived. Set after the handler, so errors get it too.
 */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
};
