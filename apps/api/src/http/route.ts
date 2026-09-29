import { createRoute, type RouteConfig } from '@hono/zod-openapi';
import { problemSchema, type Role } from '@inventory/shared';
import { requireRole } from './middleware/authenticate.ts';

const problemContent = { 'application/problem+json': { schema: problemSchema } };

type ProblemResponse = { description: string; content: typeof problemContent };

const authResponses = {
  401: { description: 'Not signed in', content: problemContent },
  403: { description: 'The role is too low for this action', content: problemContent },
} satisfies Record<number, ProblemResponse>;

/** Errors a route can list in `errors`, besides the 400 that any route with `request` gets. */
type ListedError = 404 | 409 | 422;

const listedResponses: Record<ListedError, ProblemResponse> = {
  404: { description: 'The record does not exist', content: problemContent },
  409: { description: 'Clashes with the current state: stale version, duplicate, archived', content: problemContent },
  422: { description: 'Refers to something that does not exist or is not allowed', content: problemContent },
};

const validationResponse: ProblemResponse = {
  description: 'The request is invalid; `details` lists the offending fields',
  content: problemContent,
};

type RouteInput<P extends string, E extends ListedError> = Omit<RouteConfig, 'path' | 'middleware' | 'security'> & {
  path: P;
  /** The lowest role allowed to call the route. Required: a route cannot be written without it. */
  minRole: Role;
  /** Problem responses this route can return besides 400/401/403; they only document the OpenAPI operation. */
  errors?: readonly E[];
};

type ErrorResponses<E extends ListedError> = { [S in E]: ProblemResponse };
type ValidationResponses<R> = R extends { request: object } ? { 400: ProblemResponse } : Record<never, never>;

/**
 * `createRoute` for every route except the public ones. It attaches `requireRole(minRole)`,
 * records the role in the OpenAPI operation (`x-min-role`, which the auth-matrix test checks),
 * and adds the standard responses: 401 and 403 always, 400 when the route validates a request,
 * plus whatever `errors` lists. A response written in `responses` wins over these.
 */
export function defineRoute<P extends string, E extends ListedError, R extends RouteInput<P, E>>(route: R) {
  const { minRole, errors, ...config } = route;
  const listed = Object.fromEntries((errors ?? []).map((status) => [status, listedResponses[status]]));
  const validation = config.request ? { 400: validationResponse } : {};
  return createRoute({
    ...config,
    security: [{ cookieAuth: [] }],
    middleware: [requireRole(minRole)],
    responses: {
      ...authResponses,
      ...(validation as ValidationResponses<R>),
      ...(listed as ErrorResponses<E>),
      ...config.responses,
    },
    'x-min-role': minRole,
  });
}
