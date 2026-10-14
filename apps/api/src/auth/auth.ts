import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { user } from '../db/schema/index.ts';

export type AuthDeps = {
  db: Db;
  /** Public origin of the app. The only origin allowed to call the auth endpoints. */
  baseUrl: string;
  /** At least 32 characters; signs the session cookie. */
  secret: string;
  isProduction: boolean;
  google?: { clientId: string; clientSecret: string };
};

/** The sign-in page is public. Better Auth checks it when a password is set or changed, not at sign-in. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Sign-in attempts per client IP: at most this many, each within `window` seconds of the one
 * before. Generous for an office behind one address, slow for guessing. Better Auth's own rules
 * (3 in 10 s for password changes, 100 in 10 s for the rest) cover the other paths.
 */
export const SIGN_IN_RATE_LIMIT = { window: 15 * 60, max: 20 };

/**
 * Google's front ends, which may add themselves to X-Forwarded-For. Naming any trusted proxy makes
 * Better Auth read the header from the right, where Cloud Run puts the address it saw; the left end
 * is whatever the client sent. Without one, a client that sends the header itself ends up in a
 * bucket shared with every request whose address cannot be read.
 */
const GOOGLE_FRONT_ENDS = ['35.191.0.0/16', '130.211.0.0/22'];

// After changing anything that affects the schema, run `pnpm auth:generate` and `pnpm db:generate`.
export function createAuth({ db, baseUrl, secret, isProduction, google }: AuthDeps) {
  return betterAuth({
    baseURL: baseUrl,
    secret,
    trustedOrigins: [baseUrl],
    database: drizzleAdapter(db, { provider: 'pg' }),
    // Invite-only: nobody can create their own account, by password or through Google. An
    // uninvited Google account is rejected instead of getting a new user.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    socialProviders: google ? { google: { ...google, disableSignUp: true } } : {},
    // In the database, so the count is shared by every Cloud Run instance and survives a deploy.
    // Off outside production, like Better Auth's default, so tests and local sign-ins are not limited.
    rateLimit: {
      enabled: isProduction,
      storage: 'database',
      customRules: { '/sign-in/email': SIGN_IN_RATE_LIMIT },
    },
    advanced: {
      database: { generateId: 'uuid' },
      // The session cookie is HTTP-only and SameSite=Lax always, and Secure in production.
      useSecureCookies: isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { trustedProxies: GOOGLE_FRONT_ENDS },
    },
    databaseHooks: {
      session: {
        create: {
          // A deactivated user cannot start a new session, by password or through Google.
          before: async (newSession) => {
            const [row] = await db.select({ isActive: user.isActive }).from(user).where(eq(user.id, newSession.userId));
            if (!row?.isActive) return false;
          },
        },
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'read', input: false },
        isActive: { type: 'boolean', defaultValue: true, input: false },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
