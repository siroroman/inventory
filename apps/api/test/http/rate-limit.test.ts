import { describe, expect, it } from 'vitest';
import { SIGN_IN_RATE_LIMIT } from '../../src/auth/auth.ts';
import { rateLimit } from '../../src/db/schema/index.ts';
import { BASE_URL, createTestApp, insertUserWithPassword, TEST_PASSWORD } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';

const db = useTestDb();

type App = ReturnType<typeof createTestApp>['app'];

/** A sign-in as it reaches the service behind Cloud Run, which appends the address it saw. */
function signInFrom(app: App, forwardedFor: string, email: string, password = 'not-the-password') {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL, 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ email, password }),
  });
}

/** Status codes of `count` failed sign-ins, one after another. */
async function attempts(count: number, send: (i: number) => Response | Promise<Response>): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await send(i)).status);
  return statuses;
}

const allowed = Array(SIGN_IN_RATE_LIMIT.max).fill(401);

describe('sign-in rate limit', () => {
  it('refuses a client address after the allowed attempts, even with the right password', async () => {
    const { app } = createTestApp(db().app, { isProduction: true });
    const { email } = await insertUserWithPassword(db().app);
    expect(await attempts(SIGN_IN_RATE_LIMIT.max, () => signInFrom(app, '203.0.113.7', email))).toEqual(allowed);
    expect((await signInFrom(app, '203.0.113.7', email, TEST_PASSWORD)).status).toBe(429);
    // Another address is counted on its own.
    expect((await signInFrom(app, '203.0.113.8', email, TEST_PASSWORD)).status).toBe(200);
  });

  it('counts the address Cloud Run saw, not the one the client wrote in front of it', async () => {
    const { app } = createTestApp(db().app, { isProduction: true });
    const { email } = await insertUserWithPassword(db().app);
    const spoofed = (i: number) => signInFrom(app, `198.51.100.${i}, 203.0.113.7`, email);
    expect(await attempts(SIGN_IN_RATE_LIMIT.max, spoofed)).toEqual(allowed);
    expect((await spoofed(99)).status).toBe(429);
  });

  it('shares the count between instances of the service', async () => {
    const instances = [createTestApp(db().app, { isProduction: true }), createTestApp(db().app, { isProduction: true })];
    const { email } = await insertUserWithPassword(db().app);
    const send = (i: number) => signInFrom(instances[i % 2]!.app, '203.0.113.7', email);
    expect(await attempts(SIGN_IN_RATE_LIMIT.max, send)).toEqual(allowed);
    expect((await send(1)).status).toBe(429);
    // In the table, not in memory: Better Auth's memory store is shared by every instance in one process too.
    expect(await db().app.select({ key: rateLimit.key, count: rateLimit.count }).from(rateLimit)).toEqual([
      { key: '203.0.113.7|/sign-in/email', count: SIGN_IN_RATE_LIMIT.max },
    ]);
  });

  it('is off outside production', async () => {
    const { app } = createTestApp(db().app);
    const { email } = await insertUserWithPassword(db().app);
    const statuses = await attempts(SIGN_IN_RATE_LIMIT.max + 1, () => signInFrom(app, '203.0.113.7', email));
    expect(statuses).toEqual([...allowed, 401]);
  });
});
