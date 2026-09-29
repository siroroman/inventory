import { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { requestId } from 'hono/request-id';
import type { Auth } from './auth/auth.ts';
import type { AppEnv } from './http/env.ts';
import { applyErrorHandling, problemResponse, validationHook } from './http/errors.ts';
import type { Logger } from './http/logger.ts';
import { authenticate } from './http/middleware/authenticate.ts';
import { requestLog } from './http/middleware/request-log.ts';
import { securityHeaders } from './http/middleware/security-headers.ts';
import { createSystemRoutes } from './routes/system.ts';

/** Requests are small JSON documents; photos go straight to storage through signed URLs. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The only /api/v1 paths that work without signing in. Everything else is authenticated by
 * default, including paths that do not exist, so a new route cannot be left open by accident.
 */
export const publicPaths: ReadonlySet<string> = new Set(['/api/v1/health', '/api/v1/openapi.json']);

export type AppDeps = {
  auth: Auth;
  /** Public origin of the app; the only origin allowed to send state-changing form requests. */
  baseUrl: string;
  isProduction: boolean;
  log: Logger;
};

/**
 * Builds the API. Everything it needs comes in through `deps`, so tests can build it against a
 * throwaway database and read the log.
 */
export function createApp({ auth, baseUrl, isProduction, log }: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use(requestId());
  app.use(requestLog(log));
  app.use(securityHeaders({ isProduction }));
  app.use(
    '/api/*',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => problemResponse(c, 'payload_too_large') }),
  );
  applyErrorHandling(app, { log });

  // Better Auth: sign-in, sign-out, Google callback, password reset. Public by nature.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.use('/api/v1/*', csrf({ origin: baseUrl }));
  app.use('/api/v1/*', authenticate(auth, { publicPaths }));

  const routes = app.route('/api/v1', createSystemRoutes());

  routes.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Session cookie set by /api/auth/sign-in/email (prefixed __Secure- in production).',
  });
  routes.doc31('/api/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Evidence majetku API', version: '1.0.0' },
  });

  return routes;
}

/** The SPA imports this type only, to build its typed `hc` client. */
export type AppType = ReturnType<typeof createApp>;
