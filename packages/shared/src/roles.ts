export const roles = ['read', 'write', 'admin'] as const;
export type Role = (typeof roles)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (roles as readonly string[]).includes(value);
}

const rank: Record<Role, number> = { read: 0, write: 1, admin: 2 };

/** Whether `role` grants at least the permissions of `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return rank[role] >= rank[minimum];
}
