import type { UserDto } from '@inventory/shared';
import type { User } from './repository.ts';

/** Leaves out what the admin screens do not need (avatar, verification flag, update time). */
export function toUserDto(row: User): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserDto['role'],
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}
