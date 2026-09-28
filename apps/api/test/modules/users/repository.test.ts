import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { session } from '../../../src/db/schema/index.ts';
import { createUserRepository } from '../../../src/modules/users/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

describe('user repository', () => {
  const t = useTestDb();
  const repo = () => createUserRepository(t().app);

  const addSession = (userId: string) =>
    t().app.insert(session).values({ userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), updatedAt: new Date() });

  it('finds users by id and by email in any case', async () => {
    const u = await insertUser(t().app, { email: 'jana.novakova@example.test' });
    expect((await repo().findById(u.id))?.email).toBe('jana.novakova@example.test');
    expect((await repo().findByEmail('Jana.Novakova@EXAMPLE.test'))?.id).toBe(u.id);
    expect(await repo().findByEmail('nobody@example.test')).toBeUndefined();
  });

  it('lists users by name in Czech order', async () => {
    for (const name of ['Zdeněk Malý', 'Čeněk Holý', 'Adam Horák', 'Chrudoš Brynda']) await insertUser(t().app, { name });
    expect((await repo().list()).map((u) => u.name)).toEqual(['Adam Horák', 'Čeněk Holý', 'Chrudoš Brynda', 'Zdeněk Malý']);
  });

  it('changes the role, and the database still rejects an unknown one', async () => {
    const u = await insertUser(t().app);
    expect(await repo().setRole(u.id, 'write')).toMatchObject({ role: 'write' });
    await expectPgError(repo().setRole(u.id, 'owner' as never), { code: PG.checkViolation, constraint: 'user_role_valid' });
    expect(await repo().setRole(randomUUID(), 'admin')).toBeUndefined();
  });

  it('deactivates a user and ends only their sessions', async () => {
    const u = await insertUser(t().app);
    const other = await insertUser(t().app);
    await addSession(u.id);
    await addSession(u.id);
    await addSession(other.id);

    expect(await repo().setActive(u.id, false)).toMatchObject({ isActive: false });
    expect(await repo().deleteSessions(u.id)).toBe(2);
    expect(await repo().deleteSessions(other.id)).toBe(1);
    expect(await repo().setActive(u.id, true)).toMatchObject({ isActive: true });
  });
});
