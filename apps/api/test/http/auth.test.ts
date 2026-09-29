import { OpenAPIHono, z } from '@hono/zod-openapi';
import { meSchema, problemSchema, roles } from '@inventory/shared';
import { eq } from 'drizzle-orm';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { session, user } from '../../src/db/schema/index.ts';
import type { AppEnv } from '../../src/http/env.ts';
import { applyErrorHandling, validationHook } from '../../src/http/errors.ts';
import { authenticate } from '../../src/http/middleware/authenticate.ts';
import { defineRoute } from '../../src/http/route.ts';
import { createRouter } from '../../src/http/router.ts';
import {
  BASE_URL,
  cookieFrom,
  createTestApp,
  createTestAuth,
  insertUserWithPassword,
  loginAs,
  setActive,
  signIn,
} from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';

const db = useTestDb();

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  expect(problemSchema.parse(await res.json()).code).toBe(code);
}

describe('GET /api/v1/me', () => {
  it('is 401 without a session', async () => {
    const { app } = createTestApp(db().app);
    await expectProblem(await app.request('/api/v1/me'), 401, 'unauthenticated');
  });

  it.each(roles)('returns the signed-in %s', async (role) => {
    const { app } = createTestApp(db().app);
    const { user: row, headers } = await loginAs(app, db().app, role);
    const res = await app.request('/api/v1/me', { headers });
    expect(res.status).toBe(200);
    expect(meSchema.parse(await res.json())).toEqual({ id: row.id, email: row.email, name: row.name, role });
  });

  it('is 401 for a forged or tampered cookie', async () => {
    const { app } = createTestApp(db().app);
    const { headers } = await loginAs(app, db().app, 'admin');
    const forged = { cookie: `${headers.cookie}x` };
    await expectProblem(await app.request('/api/v1/me', { headers: forged }), 401, 'unauthenticated');
    await expectProblem(
      await app.request('/api/v1/me', { headers: { cookie: 'better-auth.session_token=made-up.value' } }),
      401,
      'unauthenticated',
    );
  });

  it('is 401 once the session is deleted', async () => {
    const { app } = createTestApp(db().app);
    const { user: row, headers } = await loginAs(app, db().app, 'write');
    await db().app.delete(session).where(eq(session.userId, row.id));
    await expectProblem(await app.request('/api/v1/me', { headers }), 401, 'unauthenticated');
  });

  it('is 401 for a deactivated user even if the session survived', async () => {
    const { app } = createTestApp(db().app);
    const { user: row, headers } = await loginAs(app, db().app, 'write');
    await setActive(db().app, row.id, false);
    await expectProblem(await app.request('/api/v1/me', { headers }), 401, 'unauthenticated');
  });

  it('sets a fresh cookie when the session is past its refresh age', async () => {
    const { app } = createTestApp(db().app);
    const { user: row, headers } = await loginAs(app, db().app, 'read');
    const before = await app.request('/api/v1/me', { headers });
    expect(before.headers.getSetCookie()).toHaveLength(0);

    // Sessions last 7 days and are refreshed after 1 day; make this one 2 days old.
    await db().app.update(session).set({ expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000) }).where(eq(session.userId, row.id));
    const after = await app.request('/api/v1/me', { headers });
    expect(after.status).toBe(200);
    expect(after.headers.getSetCookie().join(';')).toMatch(/session_token=/);
  });
});

describe('authentication is the default', () => {
  it('answers 401 for an unknown /api/v1 path without a session, and 404 with one', async () => {
    const { app } = createTestApp(db().app);
    await expectProblem(await app.request('/api/v1/does-not-exist'), 401, 'unauthenticated');
    const { headers } = await loginAs(app, db().app, 'read');
    await expectProblem(await app.request('/api/v1/does-not-exist', { headers }), 404, 'not_found');
  });
});

describe('requireRole', () => {
  // A route that needs admin, on an app that has the real authentication and error handling.
  function adminApp() {
    const auth = createTestAuth(db().app);
    const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
    app.use(requestId());
    applyErrorHandling(app, { log: () => {} });
    app.use('/*', authenticate(auth, { publicPaths: new Set() }));
    const route = defineRoute({
      method: 'get',
      path: '/admin-only',
      minRole: 'admin',
      responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } } },
    });
    app.route('/', createRouter().openapi(route, (c) => c.json({ ok: true as const }, 200)));
    return { app, auth };
  }

  it.each([
    ['read', 403],
    ['write', 403],
    ['admin', 200],
  ] as const)('%s gets %i on an admin route', async (role, status) => {
    const { app, auth } = adminApp();
    const row = await insertUserWithPassword(db().app, { role });
    // This app has no /api/auth mount, so sign in through Better Auth directly.
    const signedIn = await signIn({ request: (path, init) => auth.handler(new Request(`${BASE_URL}${path}`, init)) }, row.email);
    const res = await app.request('/admin-only', { headers: { cookie: cookieFrom(signedIn) } });
    expect(res.status).toBe(status);
    if (status === 403) expect(problemSchema.parse(await res.json()).code).toBe('forbidden');
  });
});

describe('sign-in', () => {
  it('sets an HTTP-only, SameSite=Lax session cookie', async () => {
    const { app } = createTestApp(db().app);
    const row = await insertUserWithPassword(db().app);
    const res = await signIn(app, row.email);
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token'));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it('marks the session cookie Secure in production', async () => {
    const { app } = createTestApp(db().app, { isProduction: true });
    const row = await insertUserWithPassword(db().app);
    const res = await signIn(app, row.email);
    const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token'));
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/^__Secure-/);
  });

  it('rejects a wrong password without a cookie', async () => {
    const { app } = createTestApp(db().app);
    const row = await insertUserWithPassword(db().app);
    const res = await signIn(app, row.email, 'wrong password');
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it('does not start a session for a deactivated user', async () => {
    const { app } = createTestApp(db().app);
    const row = await insertUserWithPassword(db().app, { isActive: false });
    const res = await signIn(app, row.email);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.getSetCookie().filter((c) => c.includes('session_token='))).toHaveLength(0);
    expect(await db().app.select().from(session).where(eq(session.userId, row.id))).toHaveLength(0);
  });

  it('does not let anyone sign themselves up', async () => {
    const { app } = createTestApp(db().app);
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ email: 'stranger@example.com', name: 'Stranger', password: 'a-long-enough-password' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db().app.select().from(user).where(eq(user.email, 'stranger@example.com'))).toHaveLength(0);
  });

  it('turns off sign-up for Google, so an uninvited account is rejected', () => {
    const auth = createTestAuth(db().app, { google: { clientId: 'id', clientSecret: 'secret' } });
    expect(auth.options.socialProviders?.google?.disableSignUp).toBe(true);
  });
});

describe('CSRF', () => {
  it('rejects a cross-origin form post', async () => {
    const { app } = createTestApp(db().app);
    const { headers } = await loginAs(app, db().app, 'admin');
    const res = await app.request('/api/v1/me', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      body: 'a=b',
    });
    await expectProblem(res, 403, 'forbidden');
  });

  it('lets the app own origin through to authentication', async () => {
    const { app } = createTestApp(db().app);
    const res = await app.request('/api/v1/me', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE_URL },
      body: 'a=b',
    });
    await expectProblem(res, 401, 'unauthenticated');
  });
});
