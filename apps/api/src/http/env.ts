import type { Actor } from '../auth/roles.ts';

/** Hono environment shared by every route: what middleware puts on the request context. */
export type AppEnv = {
  Variables: {
    requestId: string;
    /** Set by the session middleware on every authenticated route. */
    actor: Actor;
    /** Who the actor is, for `GET /me`; never used for permissions. */
    profile: { email: string; name: string };
  };
};
