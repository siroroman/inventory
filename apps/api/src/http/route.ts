import { createRoute, type RouteConfig } from '@hono/zod-openapi';
import { problemSchema, type Role } from '@inventory/shared';
import { requireRole } from './middleware/authenticate.ts';

const problemContent = { 'application/problem+json': { schema: problemSchema } };

const authResponses = {
  401: { description: 'Not signed in', content: problemContent },
  403: { description: 'The role is too low for this action', content: problemContent },
} as const;

type RouteInput<P extends string> = Omit<RouteConfig, 'path' | 'middleware' | 'security'> & {
  path: P;
  /** The lowest role allowed to call the route. Required: a route cannot be written without it. */
  minRole: Role;
};

/**
 * `createRoute` for every route except the public ones. It attaches `requireRole(minRole)`,
 * records the role in the OpenAPI operation (`x-min-role`, which the auth-matrix test checks),
 * and adds the standard 401 and 403 responses.
 */
export function defineRoute<P extends string, R extends RouteInput<P>>(route: R) {
  const { minRole, ...config } = route;
  return createRoute({
    ...config,
    security: [{ cookieAuth: [] }],
    middleware: [requireRole(minRole)],
    responses: { ...authResponses, ...config.responses },
    'x-min-role': minRole,
  });
}
