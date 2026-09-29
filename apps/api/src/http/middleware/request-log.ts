import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';
import type { Logger } from '../logger.ts';

/**
 * One access-log line per request, after the response is ready. It records the path without the
 * query string (searches can contain personal data) and never touches headers or bodies, so
 * cookies and passwords cannot end up in the logs.
 */
export function requestLog(log: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const status = c.res.status;
    log({
      severity: status >= 500 ? 'ERROR' : 'INFO',
      message: 'request',
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: Math.round(performance.now() - started),
    });
  };
}
