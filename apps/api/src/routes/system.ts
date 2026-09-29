import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../http/env.ts';

const health = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Liveness check',
  responses: {
    200: {
      description: 'The process is up',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
});

/** Routes that belong to no domain module. Mounted under /api/v1. */
export function createSystemRoutes() {
  return new OpenAPIHono<AppEnv>().openapi(health, (c) => c.json({ status: 'ok' as const }, 200));
}
