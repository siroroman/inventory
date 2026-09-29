import { idParam, inviteUserBody, updateUserBody, userListSchema, userSchema } from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toUserDto } from './dto.ts';
import type { UserService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/users',
  minRole: 'admin',
  tags: ['users'],
  summary: 'List every user by name, deactivated ones too',
  responses: { 200: { description: 'The users', content: jsonContent(userListSchema) } },
});

const invite = defineRoute({
  method: 'post',
  path: '/users',
  minRole: 'admin',
  tags: ['users'],
  summary: 'Invite a person by email; the address must not have an account yet, ignoring case',
  request: { body: { required: true, content: jsonContent(inviteUserBody) } },
  errors: [409],
  responses: { 201: { description: 'The invited user', content: jsonContent(userSchema) } },
});

const update = defineRoute({
  method: 'patch',
  path: '/users/{id}',
  minRole: 'admin',
  tags: ['users'],
  summary: 'Change a role, or deactivate or reactivate an account (deactivating ends its sessions); not your own, and not the last active admin',
  request: { params: idParam, body: { required: true, content: jsonContent(updateUserBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The updated user', content: jsonContent(userSchema) } },
});

/** Managing users, for admins. Mounted under /api/v1. */
export function createUserRoutes(users: UserService) {
  return createRouter()
    .openapi(list, async (c) => {
      const rows = await users.list(c.get('actor'));
      return c.json({ items: rows.map(toUserDto) }, 200);
    })
    .openapi(invite, async (c) => {
      const row = await users.invite(c.get('actor'), c.req.valid('json'));
      return c.json(toUserDto(row), 201);
    })
    .openapi(update, async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const actor = c.get('actor');
      const row = 'role' in body ? await users.changeRole(actor, id, body.role) : await users.setActive(actor, id, body.isActive);
      return c.json(toUserDto(row), 200);
    });
}
