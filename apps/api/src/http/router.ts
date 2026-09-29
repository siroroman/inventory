import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from './env.ts';
import { validationHook } from './errors.ts';

/**
 * Every module builds its routes on this router. Each router validates on its own, so the
 * validation hook (400 problem+json) has to be set on all of them, not only on the root app.
 */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
}
