import { createRoute, z } from '@hono/zod-openapi';
import { meSchema } from '@inventory/shared';
import { defineRoute } from '../http/route.ts';
import { createRouter } from '../http/router.ts';

const health = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Liveness check',
  // Public: listed in `publicPaths` (app.ts), which the authentication middleware skips.
  security: [],
  responses: {
    200: {
      description: 'The process is up',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
});

const me = defineRoute({
  method: 'get',
  path: '/me',
  minRole: 'read',
  tags: ['system'],
  summary: 'The signed-in user and their role',
  responses: {
    200: { description: 'The signed-in user', content: { 'application/json': { schema: meSchema } } },
  },
});

/** Routes that belong to no domain module. Mounted under /api/v1. */
export function createSystemRoutes() {
  return createRouter()
    .openapi(health, (c) => c.json({ status: 'ok' as const }, 200))
    .openapi(me, (c) => {
      const { id, role } = c.get('actor');
      const { email, name } = c.get('profile');
      return c.json({ id, email, name, role }, 200);
    });
}
