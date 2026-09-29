import { randomUUID } from 'node:crypto';
import type { Role } from '../../src/auth/roles.ts';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type { User, UserRepository } from '../../src/modules/users/repository.ts';
import type { InviteInput, UserInvites, UserRepos } from '../../src/modules/users/service.ts';
import { createFakeAuditRepository } from './audit.ts';
import { fakeTransact } from './common.ts';

const collator = new Intl.Collator('cs');

export function createFakeUserStore() {
  const state = {
    users: [] as User[],
    sessions: [] as { id: string; userId: string }[],
    audit: [] as AuditEntry[],
  };
  const byId = (id: string) => state.users.find((u) => u.id === id);
  const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  function addUser(name: string, role: Role = 'read', extra: Partial<User> = {}): User {
    const row: User = {
      id: randomUUID(),
      name,
      email: `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role,
      isActive: true,
      ...extra,
    };
    state.users.push(row);
    return { ...row };
  }

  const users: UserRepository = {
    async findById(id) {
      const row = byId(id);
      return row && { ...row };
    },
    async findByEmail(email) {
      const row = state.users.find((u) => sameEmail(u.email, email));
      return row && { ...row };
    },
    async list() {
      return [...state.users].sort((a, b) => collator.compare(a.name, b.name)).map((u) => ({ ...u }));
    },
    async setRole(id, role) {
      const row = byId(id);
      if (row) row.role = role;
      return row && { ...row };
    },
    async setActive(id, isActive) {
      const row = byId(id);
      if (row) row.isActive = isActive;
      return row && { ...row };
    },
    async deleteSessions(userId) {
      const ended = state.sessions.filter((s) => s.userId === userId).length;
      state.sessions.splice(0, state.sessions.length, ...state.sessions.filter((s) => s.userId !== userId));
      return ended;
    },
  };

  const sent: InviteInput[] = [];
  const inviteState = { fail: false };
  const invites: UserInvites = {
    async invite(input) {
      if (inviteState.fail) throw new Error('email provider unavailable');
      sent.push(input);
      return addUser(input.name, input.role, { email: input.email });
    },
  };

  const repos: UserRepos = { users, audit: createFakeAuditRepository(state.audit) };

  const snapshot = () => {
    const copy = structuredClone(state);
    return () => {
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        state[key].splice(0, state[key].length, ...(copy[key] as never[]));
      }
    };
  };

  return {
    state,
    repos,
    invites,
    transact: fakeTransact(repos, { snapshot }),
    /** Invitations "sent" so far, and a switch to make the provider fail. */
    sent,
    inviteState,
    addUser,
    addSession: (userId: string) => state.sessions.push({ id: randomUUID(), userId }),
  };
}
