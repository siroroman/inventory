import { userListSchema, userSchema } from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, session, user } from '../../src/db/schema/index.ts';
import { createTestApp, insertUserWithPassword, loginAs, signIn } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertUser } from '../helpers/factories.ts';
import { api, expectJson, expectProblem } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

async function setup() {
  const { app, logs, invitations } = createTestApp(db().app);
  const as = async (role: 'read' | 'write' | 'admin') => {
    const login = await loginAs(app, db().app, role);
    return { ...login, client: api(app, login.headers) };
  };
  const admin = await as('admin');
  return { app, logs, invitations, admin: admin.client, adminUser: admin.user, as, anonymous: api(app) };
}

const auditOf = (id: string) =>
  db().app.select().from(auditLog).where(and(eq(auditLog.entityType, 'user'), eq(auditLog.entityId, id))).orderBy(auditLog.id);

const sessionCount = async (userId: string) =>
  (await db().app.select().from(session).where(eq(session.userId, userId))).length;

describe('GET /users', () => {
  it('lists every user by name in Czech order, deactivated ones included', async () => {
    const { admin } = await setup();
    await insertUser(db().app, { name: 'Zdeněk Malý', role: 'write' });
    await insertUser(db().app, { name: 'Čeněk Holý', role: 'read', isActive: false });

    const body = await expectJson(await admin.get('/users'), 200, userListSchema);
    // The admin is 'Jana Nováková' (the factory default).
    expect(body.items.map((u) => u.name)).toEqual(['Čeněk Holý', 'Jana Nováková', 'Zdeněk Malý']);
    expect(body.items.find((u) => u.name === 'Čeněk Holý')).toMatchObject({ role: 'read', isActive: false });
  });

  it('returns only what the admin screens need', async () => {
    const { admin, adminUser } = await setup();
    const body = await expectJson(await admin.get('/users'), 200, userListSchema);
    expect(Object.keys(body.items[0]!).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'name', 'role']);
    expect(body.items[0]).toMatchObject({ id: adminUser.id, email: adminUser.email, role: 'admin', isActive: true });
  });

  it('is 401 without a session and 403 for read and write', async () => {
    const { anonymous, as } = await setup();
    await expectProblem(await anonymous.get('/users'), 401, 'unauthenticated');
    for (const role of ['read', 'write'] as const) {
      await expectProblem(await (await as(role)).client.get('/users'), 403, 'forbidden');
    }
  });
});

describe('POST /users', () => {
  it('invites a user with a lower-cased email, sends the invitation and audits it', async () => {
    const { admin, adminUser, invitations } = await setup();
    const body = await expectJson(
      await admin.post('/users', { email: '  Jana@Example.test ', name: ' Jana Nováková ', role: 'write' }),
      201,
      userSchema,
    );

    expect(body).toMatchObject({ email: 'jana@example.test', name: 'Jana Nováková', role: 'write', isActive: true });
    expect(invitations.sent).toEqual([{ email: 'jana@example.test', name: 'Jana Nováková', role: 'write' }]);
    expect((await expectJson(await admin.get('/users'), 200, userListSchema)).items.map((u) => u.id)).toContain(body.id);
    const entries = await auditOf(body.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: adminUser.id,
      action: 'create',
      changes: {
        email: { from: null, to: 'jana@example.test' },
        name: { from: null, to: 'Jana Nováková' },
        role: { from: null, to: 'write' },
      },
    });
  });

  it('answers 409 for an email that already has an account, in any case, and sends nothing', async () => {
    const { admin, adminUser, invitations } = await setup();
    await expectProblem(
      await admin.post('/users', { email: adminUser.email.toUpperCase(), name: 'Dvojník', role: 'read' }),
      409,
      'email_taken',
    );
    expect(invitations.sent).toEqual([]);
  });

  it('answers 400 for a bad email, name, role or an unknown field, and sends nothing', async () => {
    const { admin, invitations } = await setup();
    const valid = { email: 'jana@example.test', name: 'Jana', role: 'read' };
    for (const bad of [
      { ...valid, email: 'not-an-email' },
      { ...valid, email: `${'a'.repeat(250)}@example.test` },
      { ...valid, name: '   ' },
      { ...valid, name: 'x'.repeat(121) },
      { ...valid, role: 'owner' },
      { email: valid.email, name: valid.name },
      { ...valid, isActive: false },
    ]) {
      await expectProblem(await admin.post('/users', bad), 400, 'validation_error');
    }
    expect(invitations.sent).toEqual([]);
  });

  it('is 401 without a session and 403 for read and write, inviting nobody', async () => {
    const { anonymous, as, invitations } = await setup();
    const body = { email: 'jana@example.test', name: 'Jana', role: 'admin' };
    await expectProblem(await anonymous.post('/users', body), 401, 'unauthenticated');
    for (const role of ['read', 'write'] as const) {
      await expectProblem(await (await as(role)).client.post('/users', body), 403, 'forbidden');
    }
    expect(invitations.sent).toEqual([]);
    expect(await db().app.select().from(user).where(eq(user.email, body.email))).toEqual([]);
  });

  it('answers 500 without leaking details when the invitation fails, and audits nothing', async () => {
    const { admin, invitations, logs } = await setup();
    invitations.fail();
    const res = await admin.post('/users', { email: 'jana@example.test', name: 'Jana', role: 'read' });
    const problem = await expectProblem(res, 500, 'internal_error');
    expect(JSON.stringify(problem)).not.toContain('provider');
    expect(logs.some((entry) => entry.message === 'unhandled error')).toBe(true);
    expect(await db().app.select().from(auditLog).where(eq(auditLog.entityType, 'user'))).toEqual([]);
  });
});

describe('PATCH /users/{id}', () => {
  it('changes the role, audits it and applies it to the user at once', async () => {
    const { admin, adminUser, as } = await setup();
    const jana = await as('admin');

    const body = await expectJson(await admin.patch(`/users/${jana.user.id}`, { role: 'read' }), 200, userSchema);
    expect(body).toMatchObject({ id: jana.user.id, role: 'read', isActive: true });
    // Her session survives, but the role is read from the database on every request.
    await expectProblem(await jana.client.get('/users'), 403, 'forbidden');
    const entries = await auditOf(jana.user.id);
    expect(entries.at(-1)).toMatchObject({ userId: adminUser.id, action: 'update', changes: { role: { from: 'admin', to: 'read' } } });
  });

  it('does not audit a role that is already set', async () => {
    const { admin, as } = await setup();
    const jana = await as('write');
    await expectJson(await admin.patch(`/users/${jana.user.id}`, { role: 'write' }), 200, userSchema);
    expect(await auditOf(jana.user.id)).toEqual([]);
  });

  it('deactivates a user, ends their sessions at once and keeps them from signing in again', async () => {
    const { app, admin, adminUser, as } = await setup();
    const jana = await as('write');
    expect((await jana.client.get('/me')).status).toBe(200);
    expect(await sessionCount(jana.user.id)).toBe(1);

    const body = await expectJson(await admin.patch(`/users/${jana.user.id}`, { isActive: false }), 200, userSchema);
    expect(body).toMatchObject({ isActive: false, role: 'write' });
    expect(await sessionCount(jana.user.id)).toBe(0);
    await expectProblem(await jana.client.get('/me'), 401, 'unauthenticated');
    expect((await signIn(app, jana.user.email)).status).not.toBe(200);
    expect((await auditOf(jana.user.id)).at(-1)).toMatchObject({
      userId: adminUser.id,
      changes: { isActive: { from: true, to: false } },
    });
  });

  it('reactivates a user, who can then sign in again', async () => {
    const { app, admin } = await setup();
    const jana = await insertUserWithPassword(db().app, { role: 'read', isActive: false });
    expect((await signIn(app, jana.email)).status).not.toBe(200);

    const body = await expectJson(await admin.patch(`/users/${jana.id}`, { isActive: true }), 200, userSchema);
    expect(body).toMatchObject({ isActive: true, role: 'read' });
    expect((await signIn(app, jana.email)).status).toBe(200);
    expect((await auditOf(jana.id)).at(-1)).toMatchObject({ changes: { isActive: { from: false, to: true } } });
  });

  it('answers 403 when an admin changes their own role or activity', async () => {
    const { admin, adminUser } = await setup();
    await expectProblem(await admin.patch(`/users/${adminUser.id}`, { role: 'read' }), 403, 'cannot_modify_self');
    await expectProblem(await admin.patch(`/users/${adminUser.id}`, { isActive: false }), 403, 'cannot_modify_self');
    const [row] = await db().app.select().from(user).where(eq(user.id, adminUser.id));
    expect(row).toMatchObject({ role: 'admin', isActive: true });
  });

  it('answers 404 for an unknown user and 400 for a malformed id', async () => {
    const { admin } = await setup();
    await expectProblem(await admin.patch(`/users/${MISSING}`, { role: 'read' }), 404, 'not_found');
    await expectProblem(await admin.patch('/users/not-a-uuid', { role: 'read' }), 400, 'validation_error');
  });

  it('answers 400 unless the body has exactly one of role and isActive', async () => {
    const { admin } = await setup();
    const jana = await insertUser(db().app, { role: 'write' });
    for (const bad of [{}, { role: 'read', isActive: false }, { role: 'owner' }, { isActive: 'no' }, { name: 'Jiné jméno' }, { role: null }]) {
      await expectProblem(await admin.patch(`/users/${jana.id}`, bad), 400, 'validation_error');
    }
    const [row] = await db().app.select().from(user).where(eq(user.id, jana.id));
    expect(row).toMatchObject({ role: 'write', isActive: true });
  });

  it('is 401 without a session and 403 for read and write, changing nothing', async () => {
    const { anonymous, as } = await setup();
    const jana = await insertUser(db().app, { role: 'write' });
    await expectProblem(await anonymous.patch(`/users/${jana.id}`, { role: 'admin' }), 401, 'unauthenticated');
    for (const role of ['read', 'write'] as const) {
      const { client } = await as(role);
      await expectProblem(await client.patch(`/users/${jana.id}`, { role: 'admin' }), 403, 'forbidden');
      await expectProblem(await client.patch(`/users/${jana.id}`, { isActive: false }), 403, 'forbidden');
    }
    const [row] = await db().app.select().from(user).where(eq(user.id, jana.id));
    expect(row).toMatchObject({ role: 'write', isActive: true });
  });
});
