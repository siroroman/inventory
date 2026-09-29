import { type Actor, assertRole, type Role } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createUserRepository, type User, type UserRepository } from './repository.ts';

export type UserRepos = { users: UserRepository; audit: AuditRepository };

export const userRepos = (db: DbExecutor): UserRepos => ({
  users: createUserRepository(db),
  audit: createAuditRepository(db),
});

export type InviteInput = { email: string; name: string; role: Role };

/**
 * Creates the account and sends the invitation email. The Better Auth adapter implements it
 * later; it runs on its own connection, outside the service's transactions.
 */
export type UserInvites = { invite(input: InviteInput): Promise<User> };

export type UserDeps = { repos: UserRepos; transact: Transact<UserRepos>; invites: UserInvites };

/** Whether someone other than `excludeId` can still administer the app. */
function hasOtherActiveAdmin(users: User[], excludeId: string): boolean {
  return users.some((u) => u.id !== excludeId && u.isActive && u.role === 'admin');
}

/** Managing users is admin-only. Better Auth owns sign-in; this covers what the admin screens change. */
export function createUserService({ repos, transact, invites }: UserDeps) {
  /** Shared by role and active changes: the target must exist, must not be the actor, and must not be the last active admin. */
  async function loadTarget(r: UserRepos, actor: Actor, id: string, losesAdmin: (user: User) => boolean): Promise<User> {
    if (id === actor.id) throw new DomainError('cannot_modify_self');
    const target = await r.users.findById(id);
    if (!target) throw new DomainError('not_found');
    if (target.isActive && target.role === 'admin' && losesAdmin(target)) {
      if (!hasOtherActiveAdmin(await r.users.list(), id)) throw new DomainError('last_admin');
    }
    return target;
  }

  return {
    async list(actor: Actor): Promise<User[]> {
      assertRole(actor, 'admin');
      return repos.users.list();
    },

    /** Invites a new user; a person who already has an account (any case of the email) is rejected. */
    async invite(actor: Actor, input: InviteInput): Promise<User> {
      assertRole(actor, 'admin');
      if (await repos.users.findByEmail(input.email)) throw new DomainError('email_taken');
      const created = await invites.invite(input);
      await transact((r) =>
        r.audit.record({
          userId: actor.id,
          entityType: 'user',
          entityId: created.id,
          action: 'create',
          changes: {
            email: { from: null, to: created.email },
            name: { from: null, to: created.name },
            role: { from: null, to: created.role },
          },
        }),
      );
      return created;
    },

    async changeRole(actor: Actor, id: string, role: Role): Promise<User> {
      assertRole(actor, 'admin');
      return transact(async (r) => {
        const target = await loadTarget(r, actor, id, () => role !== 'admin');
        if (target.role === role) return target;
        const updated = await r.users.setRole(id, role);
        if (!updated) throw new DomainError('not_found');
        await r.audit.record({
          userId: actor.id,
          entityType: 'user',
          entityId: id,
          action: 'update',
          changes: { role: { from: target.role, to: role } },
        });
        return updated;
      });
    },

    /** Deactivating also ends every session, so it takes effect immediately. */
    async setActive(actor: Actor, id: string, isActive: boolean): Promise<User> {
      assertRole(actor, 'admin');
      return transact(async (r) => {
        const target = await loadTarget(r, actor, id, () => !isActive);
        if (target.isActive === isActive) return target;
        const updated = await r.users.setActive(id, isActive);
        if (!updated) throw new DomainError('not_found');
        if (!isActive) await r.users.deleteSessions(id);
        await r.audit.record({
          userId: actor.id,
          entityType: 'user',
          entityId: id,
          action: 'update',
          changes: { isActive: { from: target.isActive, to: isActive } },
        });
        return updated;
      });
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
