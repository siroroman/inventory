import { type Role, roleAtLeast } from '@inventory/shared';
import { DomainError } from '../errors.ts';

export { type Role, roles } from '@inventory/shared';

/** The signed-in user a service call acts for. */
export type Actor = { id: string; role: Role };

export function hasRole(actor: Actor, minimum: Role): boolean {
  return roleAtLeast(actor.role, minimum);
}

/** Services check roles again, independently of the route's requireRole(). */
export function assertRole(actor: Actor, minimum: Role): void {
  if (!hasRole(actor, minimum)) throw new DomainError('forbidden');
}
