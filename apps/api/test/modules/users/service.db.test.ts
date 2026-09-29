import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { session, user } from '../../../src/db/schema/index.ts';
import { createUserService, userRepos } from '../../../src/modules/users/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertUser } from '../../helpers/factories.ts';
import { expectCode } from '../../helpers/service-errors.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database. The
// invitation port stays a fake: the Better Auth adapter does not exist yet.
describe('user service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const admin = await insertUser(t().app, { name: 'Adam Admin', role: 'admin' });
    const actor: Actor = { id: admin.id, role: 'admin' };
    const service = createUserService({
      repos: userRepos(t().app),
      transact: transactor(t().app, userRepos),
      invites: {
        invite: async ({ email, name, role }) => insertUser(t().app, { email, name, role }),
      },
    });
    const addSession = (userId: string) =>
      t().app.insert(session).values({ userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), updatedAt: new Date() });
    return { actor, service, repos: userRepos(t().app), addSession };
  }

  it('changes roles and activity, ending sessions on deactivation, with audit entries', async () => {
    const { actor, service, repos, addSession } = await setup();
    const jana = await insertUser(t().app, { role: 'read' });
    await addSession(jana.id);
    await addSession(jana.id);

    await service.changeRole(actor, jana.id, 'write');
    await service.setActive(actor, jana.id, false);

    expect(await t().app.select().from(session)).toEqual([]);
    expect(await repos.users.findById(jana.id)).toMatchObject({ role: 'write', isActive: false });
    const history = await repos.audit.list({ entityType: 'user', entityId: jana.id }, { limit: 10 });
    expect(history.items.map((e) => e.changes)).toEqual([
      { isActive: { from: true, to: false } },
      { role: { from: 'read', to: 'write' } },
    ]);
  });

  it('protects the last active admin', async () => {
    const { actor, service } = await setup();
    const stale: Actor = { id: randomUUID(), role: 'admin' };
    await expectCode(service.setActive(stale, actor.id, false), 'last_admin');
    await expectCode(service.changeRole(stale, actor.id, 'read'), 'last_admin');
    expect((await t().app.select().from(user)).find((u) => u.id === actor.id)).toMatchObject({ role: 'admin', isActive: true });
  });

  it('invites a user and audits it', async () => {
    const { actor, service, repos } = await setup();
    const created = await service.invite(actor, { email: 'jana@example.test', name: 'Jana Nováková', role: 'write' });
    expect(created).toMatchObject({ email: 'jana@example.test', role: 'write' });
    const history = await repos.audit.list({ entityType: 'user', entityId: created.id }, { limit: 10 });
    expect(history.items.map((e) => e.action)).toEqual(['create']);
    await expectCode(service.invite(actor, { email: 'JANA@example.test', name: 'Jiná', role: 'read' }), 'email_taken');
  });
});
