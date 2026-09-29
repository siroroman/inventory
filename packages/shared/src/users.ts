import { z } from 'zod';
import { requiredText, timestamp } from './fields.ts';
import { roles } from './roles.ts';

const email = z.string().trim().max(254).pipe(z.email({ pattern: z.regexes.unicodeEmail }));

/** A user as the admin screens see them. Users are managed by Better Auth, so there is no `version` and no archiving: deactivate instead. */
export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(roles),
  isActive: z.boolean(),
  createdAt: timestamp,
});
export type UserDto = z.infer<typeof userSchema>;

/** Every user, by name. There are only a handful, so no paging. */
export const userListSchema = z.object({ items: z.array(userSchema) });

export const inviteUserBody = z.strictObject({
  email,
  name: requiredText(120),
  role: z.enum(roles),
});
export type InviteUserBody = z.infer<typeof inviteUserBody>;

/**
 * Change the role or the activity, one at a time: the two are separate actions on the user's row,
 * and separate changes cannot half-apply.
 */
export const updateUserBody = z
  .strictObject({ role: z.enum(roles), isActive: z.boolean() })
  .partial()
  .refine((body) => Object.values(body).filter((value) => value !== undefined).length === 1, {
    message: 'Send exactly one of role and isActive',
  });
export type UpdateUserBody = z.infer<typeof updateUserBody>;
