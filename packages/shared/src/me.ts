import { z } from 'zod';
import { roles } from './roles.ts';

/** The signed-in user, as `GET /me` returns it. */
export const meSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(roles),
});
export type Me = z.infer<typeof meSchema>;
