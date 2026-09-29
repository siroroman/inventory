import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { defineRoute } from '../../src/http/route.ts';

const ok = { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } };

describe('defineRoute', () => {
  it('adds 401 and 403 to every route and records the role', () => {
    const route = defineRoute({ method: 'get', path: '/x', minRole: 'write', responses: ok });
    expect(Object.keys(route.responses).sort()).toEqual(['200', '401', '403']);
    expect(route['x-min-role']).toBe('write');
  });

  it('adds 400 only when the route validates a request', () => {
    const plain = defineRoute({ method: 'get', path: '/x', minRole: 'read', responses: ok });
    const validated = defineRoute({
      method: 'get',
      path: '/x/{id}',
      minRole: 'read',
      request: { params: z.object({ id: z.uuid() }) },
      responses: ok,
    });
    expect(plain.responses).not.toHaveProperty('400');
    expect(validated.responses).toHaveProperty('400');
  });

  it('documents the errors it is told about, and lets a route override them', () => {
    const route = defineRoute({
      method: 'post',
      path: '/x/{id}/archive',
      minRole: 'write',
      errors: [404, 409, 422],
      responses: { ...ok, 409: { description: 'Already archived' } },
    });
    expect(Object.keys(route.responses).sort()).toEqual(['200', '401', '403', '404', '409', '422']);
    expect(route.responses[409].description).toBe('Already archived');
    expect(route.responses[404].content['application/problem+json']).toBeDefined();
  });
});
