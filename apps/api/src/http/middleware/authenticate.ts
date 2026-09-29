import { isRole, type Role, roleAtLeast } from '@inventory/shared';
import type { MiddlewareHandler } from 'hono';
import type { Auth } from '../../auth/auth.ts';
import type { AppEnv } from '../env.ts';
import { problemResponse } from '../errors.ts';

/**
 * Puts the signed-in user on the request context, or answers 401. Fail-closed: it runs for
 * everything it is mounted on, and only `publicPaths` skip it. A deactivated user is refused even
 * if a session survived, so deactivation never depends on session cleanup alone.
 */
export function authenticate(auth: Auth, { publicPaths }: { publicPaths: ReadonlySet<string> }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (publicPaths.has(c.req.path)) return next();

    const { headers, response } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
    const user = response?.user;
    if (!user?.isActive || !isRole(user.role)) return problemResponse(c, 'unauthenticated');

    // A session past its refresh age gets a fresh cookie, so people who keep working stay signed in.
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });

    c.set('actor', { id: user.id, role: user.role });
    c.set('profile', { email: user.email, name: user.name });
    return next();
  };
}

/** Rejects callers below `minimum` with 403. Services check the role again on their own. */
export function requireRole(minimum: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roleAtLeast(c.get('actor').role, minimum)) return problemResponse(c, 'forbidden');
    return next();
  };
}
