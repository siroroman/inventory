import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError, type ErrorCode } from '../../../src/errors.ts';
import { createUserService } from '../../../src/modules/users/service.ts';
import { createFakeUserStore } from '../../fakes/users.ts';

async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}

function setup() {
  const store = createFakeUserStore();
  const service = createUserService(store);
  const admin = store.addUser('Adam Admin', 'admin');
  const actorOf = (user: { id: string; role: string }): Actor => ({ id: user.id, role: user.role as Role });
  return { store, service, admin, adminActor: actorOf(admin), actorOf };
}

describe('user service', () => {
  describe('roles', () => {
    it('is for admins only', async () => {
      const { store, service } = setup();
      const target = store.addUser('Jana Nováková', 'write');
      const auditBefore = store.state.audit.length;

      for (const role of ['read', 'write'] as const) {
        const actor: Actor = { id: randomUUID(), role };
        await expectCode(service.list(actor), 'forbidden');
        await expectCode(service.invite(actor, { email: 'x@example.test', name: 'X', role: 'read' }), 'forbidden');
        await expectCode(service.changeRole(actor, target.id, 'admin'), 'forbidden');
        await expectCode(service.setActive(actor, target.id, false), 'forbidden');
      }

      expect(store.sent).toEqual([]);
      expect(store.state.users.find((u) => u.id === target.id)).toMatchObject({ role: 'write', isActive: true });
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('lists users by name in Czech order', async () => {
      const { store, service, adminActor } = setup();
      store.addUser('Čeněk Holý');
      store.addUser('Zdeněk Malý');
      expect((await service.list(adminActor)).map((u) => u.name)).toEqual(['Adam Admin', 'Čeněk Holý', 'Zdeněk Malý']);
    });
  });

  describe('invite', () => {
    it('creates the account through the invitation port and audits it', async () => {
      const { store, service, adminActor } = setup();
      const created = await service.invite(adminActor, { email: 'jana@example.test', name: 'Jana Nováková', role: 'write' });

      expect(created).toMatchObject({ email: 'jana@example.test', role: 'write', isActive: true });
      expect(store.sent).toEqual([{ email: 'jana@example.test', name: 'Jana Nováková', role: 'write' }]);
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: adminActor.id,
          entityType: 'user',
          entityId: created.id,
          action: 'create',
          changes: {
            email: { from: null, to: 'jana@example.test' },
            name: { from: null, to: 'Jana Nováková' },
            role: { from: null, to: 'write' },
          },
        }),
      ]);
    });

    it('rejects an email that already has an account, in any case, without sending anything', async () => {
      const { store, service, adminActor } = setup();
      store.addUser('Jana Nováková', 'read', { email: 'jana@example.test' });
      await expectCode(service.invite(adminActor, { email: 'JANA@Example.test', name: 'Jiná Jana', role: 'read' }), 'email_taken');
      expect(store.sent).toEqual([]);
      expect(store.state.users).toHaveLength(2);
    });

    it('audits nothing when the invitation fails', async () => {
      const { store, service, adminActor } = setup();
      store.inviteState.fail = true;
      await expect(service.invite(adminActor, { email: 'jana@example.test', name: 'Jana', role: 'read' })).rejects.toThrow('email provider unavailable');
      expect(store.state.audit).toEqual([]);
    });
  });

  describe('changeRole', () => {
    it('changes the role and audits the difference', async () => {
      const { store, service, adminActor } = setup();
      const jana = store.addUser('Jana Nováková', 'read');
      expect(await service.changeRole(adminActor, jana.id, 'write')).toMatchObject({ role: 'write' });
      expect(store.state.audit).toEqual([
        expect.objectContaining({
          userId: adminActor.id,
          entityType: 'user',
          entityId: jana.id,
          action: 'update',
          changes: { role: { from: 'read', to: 'write' } },
        }),
      ]);
    });

    it('audits nothing when the role is already set', async () => {
      const { store, service, adminActor } = setup();
      const jana = store.addUser('Jana Nováková', 'write');
      await service.changeRole(adminActor, jana.id, 'write');
      expect(store.state.audit).toEqual([]);
    });

    it('does not let admins change their own role', async () => {
      const { store, service, admin, adminActor } = setup();
      store.addUser('Druhý Admin', 'admin');
      await expectCode(service.changeRole(adminActor, admin.id, 'read'), 'cannot_modify_self');
      expect(store.state.users.find((u) => u.id === admin.id)!.role).toBe('admin');
    });

    it('does not demote the last active admin, but demotes one of several', async () => {
      const { store, service, actorOf } = setup();
      // A stale session of a former admin can still act as admin; the last real admin stays protected.
      const stale = actorOf({ id: randomUUID(), role: 'admin' });
      const only = store.state.users[0]!;
      await expectCode(service.changeRole(stale, only.id, 'write'), 'last_admin');

      const second = store.addUser('Druhý Admin', 'admin');
      await expect(service.changeRole(stale, second.id, 'write')).resolves.toMatchObject({ role: 'write' });
      await expectCode(service.changeRole(stale, only.id, 'write'), 'last_admin');
    });

    it('does not count an inactive admin as a spare admin', async () => {
      const { store, service, admin, actorOf } = setup();
      store.addUser('Neaktivní Admin', 'admin', { isActive: false });
      const stale = actorOf({ id: randomUUID(), role: 'admin' });
      await expectCode(service.changeRole(stale, admin.id, 'read'), 'last_admin');
    });

    it('reports an unknown user as not found', async () => {
      const { service, adminActor } = setup();
      await expectCode(service.changeRole(adminActor, randomUUID(), 'read'), 'not_found');
    });
  });

  describe('setActive', () => {
    it('deactivates a user, ends their sessions and audits it', async () => {
      const { store, service, adminActor } = setup();
      const jana = store.addUser('Jana Nováková', 'write');
      const petr = store.addUser('Petr Novák', 'write');
      store.addSession(jana.id);
      store.addSession(jana.id);
      store.addSession(petr.id);

      expect(await service.setActive(adminActor, jana.id, false)).toMatchObject({ isActive: false });

      expect(store.state.sessions.map((s) => s.userId)).toEqual([petr.id]);
      expect(store.state.audit.at(-1)).toMatchObject({
        entityId: jana.id,
        action: 'update',
        changes: { isActive: { from: true, to: false } },
      });
    });

    it('reactivates a user without touching sessions and keeps the role', async () => {
      const { store, service, adminActor } = setup();
      const jana = store.addUser('Jana Nováková', 'write', { isActive: false });
      expect(await service.setActive(adminActor, jana.id, true)).toMatchObject({ isActive: true, role: 'write' });
      expect(store.state.audit.at(-1)).toMatchObject({ changes: { isActive: { from: false, to: true } } });
    });

    it('audits nothing when the state is already set', async () => {
      const { store, service, adminActor } = setup();
      const jana = store.addUser('Jana Nováková', 'write');
      await service.setActive(adminActor, jana.id, true);
      expect(store.state.audit).toEqual([]);
    });

    it('does not let admins deactivate themselves', async () => {
      const { store, service, admin, adminActor } = setup();
      store.addSession(admin.id);
      await expectCode(service.setActive(adminActor, admin.id, false), 'cannot_modify_self');
      expect(store.state.sessions).toHaveLength(1);
    });

    it('does not deactivate the last active admin and keeps their sessions', async () => {
      const { store, service, admin, actorOf } = setup();
      store.addSession(admin.id);
      const stale = actorOf({ id: randomUUID(), role: 'admin' });
      await expectCode(service.setActive(stale, admin.id, false), 'last_admin');
      expect(store.state.users.find((u) => u.id === admin.id)!.isActive).toBe(true);
      expect(store.state.sessions).toHaveLength(1);

      const second = store.addUser('Druhý Admin', 'admin');
      await expect(service.setActive(stale, second.id, false)).resolves.toMatchObject({ isActive: false });
    });

    it('rolls back the deactivation when ending sessions fails', async () => {
      const { store, service, adminActor } = setup();
      const jana = store.addUser('Jana Nováková', 'write');
      store.repos.users.deleteSessions = async () => {
        throw new Error('database error');
      };
      await expect(service.setActive(adminActor, jana.id, false)).rejects.toThrow('database error');
      expect(store.state.users.find((u) => u.id === jana.id)!.isActive).toBe(true);
      expect(store.state.audit).toEqual([]);
    });

    it('reports an unknown user as not found', async () => {
      const { service, adminActor } = setup();
      await expectCode(service.setActive(adminActor, randomUUID(), false), 'not_found');
    });
  });
});
