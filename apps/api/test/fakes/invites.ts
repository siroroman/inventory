import type { Db } from '../../src/db/client.ts';
import type { InviteInput, UserInvites } from '../../src/modules/users/service.ts';
import { insertUser } from '../helpers/factories.ts';

/**
 * Stands in for the Better Auth + email adapter: creates the user row and records the
 * invitation. `fail()` makes the next calls throw, like an unavailable email provider.
 */
export function createFakeInvites(db: Db) {
  const sent: InviteInput[] = [];
  const state = { failing: false };
  const invites: UserInvites = {
    async invite(input) {
      if (state.failing) throw new Error('email provider unavailable');
      sent.push(input);
      return insertUser(db, input);
    },
  };
  const fail = (failing = true) => {
    state.failing = failing;
  };
  return { invites, sent, fail };
}
