import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { Role } from '@inventory/shared';
import { createApp } from '../../src/app.ts';
import { type AuthDeps, createAuth } from '../../src/auth/auth.ts';
import type { Db } from '../../src/db/client.ts';
import { account, user } from '../../src/db/schema/index.ts';
import type { LogEntry } from '../../src/http/logger.ts';
import { insertUser } from './factories.ts';

export const BASE_URL = 'http://localhost:8080';
export const TEST_SECRET = 'test-secret-that-is-at-least-32-characters';
export const TEST_PASSWORD = 'correct horse battery staple';

type TestAppOptions = { isProduction?: boolean; google?: AuthDeps['google'] };

export function createTestAuth(db: Db, options: TestAppOptions = {}) {
  return createAuth({
    db,
    baseUrl: BASE_URL,
    secret: TEST_SECRET,
    isProduction: options.isProduction ?? false,
    google: options.google,
  });
}

/** The API against a test database and in-memory logging. Requests go through `app.request()`. */
export function createTestApp(db: Db, options: TestAppOptions = {}) {
  const logs: LogEntry[] = [];
  const auth = createTestAuth(db, options);
  const app = createApp({
    auth,
    baseUrl: BASE_URL,
    isProduction: options.isProduction ?? false,
    log: (entry) => logs.push(entry),
  });
  return { app, auth, logs };
}

/** A user who can sign in with email and password, like the seeded ones. */
export async function insertUserWithPassword(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
  const row = await insertUser(db, { emailVerified: true, ...overrides });
  await db.insert(account).values({
    userId: row.id,
    accountId: row.id,
    providerId: 'credential',
    password: await hashPassword(TEST_PASSWORD),
  });
  return row;
}

type Requester = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/** Signs in through the real endpoint and returns the response (its Set-Cookie carries the session). */
export function signIn(app: Requester, email: string, password = TEST_PASSWORD) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ email, password }),
  });
}

/** The `cookie` request header for a session created by `signIn`. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Creates a user with `role`, signs them in and returns what a test needs to call as them. */
export async function loginAs(
  app: Requester,
  db: Db,
  role: Role,
  overrides: Partial<typeof user.$inferInsert> = {},
) {
  const row = await insertUserWithPassword(db, { role, ...overrides });
  const res = await signIn(app, row.email);
  if (res.status !== 200) throw new Error(`sign-in failed with ${res.status}: ${await res.text()}`);
  return { user: row, headers: { cookie: cookieFrom(res) } };
}

export async function setActive(db: Db, id: string, isActive: boolean) {
  await db.update(user).set({ isActive }).where(eq(user.id, id));
}
