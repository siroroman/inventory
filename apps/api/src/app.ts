import { OpenAPIHono } from '@hono/zod-openapi';
import { requestId } from 'hono/request-id';
import type { AppEnv } from './http/env.ts';
import type { Logger } from './http/logger.ts';
import { requestLog } from './http/middleware/request-log.ts';
import { securityHeaders } from './http/middleware/security-headers.ts';
import { createSystemRoutes } from './routes/system.ts';

export type AppDeps = {
  isProduction: boolean;
  log: Logger;
};

/**
 * Builds the API. Everything it needs comes in through `deps`, so tests can build it against a
 * throwaway database and read the log.
 */
export function createApp({ isProduction, log }: AppDeps) {
  const app = new OpenAPIHono<AppEnv>();

  app.use(requestId());
  app.use(requestLog(log));
  app.use(securityHeaders({ isProduction }));

  const routes = app.route('/api/v1', createSystemRoutes());

  routes.doc31('/api/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Evidence majetku API', version: '1.0.0' },
  });

  return routes;
}

/** The SPA imports this type only, to build its typed `hc` client. */
export type AppType = ReturnType<typeof createApp>;
