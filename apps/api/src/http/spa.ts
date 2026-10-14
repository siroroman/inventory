import { serveStatic } from '@hono/node-server/serve-static';
import type { Handler } from 'hono';

/** Vite puts a content hash in every file name under /assets, so they never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** index.html and unhashed files must be revalidated, or a deploy would not reach open browsers. */
const REVALIDATE = 'no-cache';

/**
 * Serves the built SPA from `root` (apps/web/dist) for every GET or HEAD outside /api. A path
 * that is not a file gets index.html, so deep links like /locations/<id> load the app and its
 * router takes over. /api paths are never answered with the SPA: an unknown one stays a 404.
 *
 * Text files are answered from the `.br` / `.gz` copies that `apps/web/scripts/precompress.mjs`
 * leaves next to them, when the browser accepts that encoding (a third of the bytes; Cloud Run does
 * not compress).
 */
export function serveSpa(root: string): Handler {
  const file = serveStatic({ root, precompressed: true });
  const index = serveStatic({ root, path: 'index.html', precompressed: true });
  const miss = async () => {};

  return async (c, next) => {
    const path = c.req.path;
    if (path === '/api' || path.startsWith('/api/')) return next();

    const found = await file(c, miss);
    if (found) {
      found.headers.set('Cache-Control', path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE);
      return found;
    }
    // A missing file under /assets is a stale or mistyped asset link, not a page: answer 404.
    if (path.startsWith('/assets/')) return next();

    const page = await index(c, miss);
    if (!page) return next();
    page.headers.set('Cache-Control', REVALIDATE);
    return page;
  };
}
