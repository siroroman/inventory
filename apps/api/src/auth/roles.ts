import { DomainError } from '../errors.ts';

// Moves to packages/shared once it exists; the SPA needs the same list.
export const roles = ['read', 'write', 'admin'] as const;
export type Role = (typeof roles)[number];

/** The signed-in user a service call acts for. */
export type Actor = { id: string; role: Role };

const rank: Record<Role, number> = { read: 0, write: 1, admin: 2 };

export function hasRole(actor: Actor, minimum: Role): boolean {
  return rank[actor.role] >= rank[minimum];
}

/** Services check roles again, independently of the route's requireRole(). */
export function assertRole(actor: Actor, minimum: Role): void {
  if (!hasRole(actor, minimum)) throw new DomainError('forbidden');
}
