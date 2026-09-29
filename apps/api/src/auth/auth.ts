import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from '../db/client.ts';

export type AuthDeps = {
  db: Db;
  /** Public origin of the app. The only origin allowed to call the auth endpoints. */
  baseUrl: string;
  /** At least 32 characters; signs the session cookie. */
  secret: string;
  isProduction: boolean;
  google?: { clientId: string; clientSecret: string };
};

// After changing anything that affects the schema, run `pnpm auth:generate` and `pnpm db:generate`.
export function createAuth({ db, baseUrl, secret, isProduction, google }: AuthDeps) {
  return betterAuth({
    baseURL: baseUrl,
    secret,
    trustedOrigins: [baseUrl],
    database: drizzleAdapter(db, { provider: 'pg' }),
    // Invite-only: nobody can create their own account, by password or through Google. An
    // uninvited Google account is rejected instead of getting a new user.
    emailAndPassword: { enabled: true, disableSignUp: true },
    socialProviders: google ? { google: { ...google, disableSignUp: true } } : {},
    advanced: {
      database: { generateId: 'uuid' },
      // The session cookie is HTTP-only and SameSite=Lax always, and Secure in production.
      useSecureCookies: isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
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
