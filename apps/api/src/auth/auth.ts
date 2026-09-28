import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from '../db/client.ts';

export type AuthDeps = {
  db: Db;
  google?: { clientId: string; clientSecret: string };
};

// After changing anything that affects the schema, run `pnpm auth:generate` and `pnpm db:generate`.
export function createAuth({ db, google }: AuthDeps) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    socialProviders: google ? { google } : {},
    advanced: { database: { generateId: 'uuid' } },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'read', input: false },
        isActive: { type: 'boolean', defaultValue: true, input: false },
      },
    },
  });
}
