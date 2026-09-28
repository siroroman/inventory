import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { session, user } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertLocation, insertUser } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('users and auth tables', () => {
  const t = useTestDb();
  const newSession = (userId: string, token: string = randomUUID()) =>
    t()
      .app.insert(session)
      .values({ userId, token, expiresAt: new Date(Date.now() + 86_400_000), updatedAt: new Date() });

  it('new users default to the read role and active', async () => {
    const u = await insertUser(t().app);
    expect(u).toMatchObject({ role: 'read', isActive: true });
  });

  it('rejects a reused session token', async () => {
    const u = await insertUser(t().app);
    await newSession(u.id, 'same-token');
    await expectPgError(newSession(u.id, 'same-token'), {
      code: PG.uniqueViolation,
      constraint: 'session_token_unique',
    });
  });

  it('rejects a session for an unknown user', async () => {
    await expectPgError(newSession(randomUUID()), {
      code: PG.foreignKeyViolation,
      constraint: 'session_user_id_user_id_fk',
    });
  });

  it('deactivation can remove all sessions of a user', async () => {
    const u = await insertUser(t().app);
    await newSession(u.id);
    await newSession(u.id);
    await t().app.update(user).set({ isActive: false }).where(eq(user.id, u.id));
    await t().app.delete(session).where(eq(session.userId, u.id));
    expect(await t().app.select().from(session).where(eq(session.userId, u.id))).toEqual([]);
  });

  it('removes sessions when a user row is deleted (owner-level, e.g. GDPR erasure)', async () => {
    const u = await insertUser(t().owner);
    await t().owner.insert(session).values({
      userId: u.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    });
    await t().owner.delete(user).where(eq(user.id, u.id));
    expect(await t().owner.select().from(session).where(eq(session.userId, u.id))).toEqual([]);
  });

  it('author columns must reference an existing user', async () => {
    const author = await insertUser(t().app);
    await insertLocation(t().app, { createdBy: author.id, updatedBy: author.id });
    await expectPgError(insertLocation(t().app, { createdBy: randomUUID() }), {
      code: PG.foreignKeyViolation,
      constraint: 'locations_created_by_user_id_fk',
    });
  });
});
