import { problemSchema } from '@inventory/shared';
import { expect } from 'vitest';
import type { z } from 'zod';
import type { Db } from '../../src/db/client.ts';
import { BASE_URL, loginAs } from './app.ts';

type Requester = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/** The response is a problem+json with this status and code. Returns the parsed problem. */
export async function expectProblem(res: Response, status: number, code: string) {
  const body = await res.text();
  expect(res.status, body).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  const problem = problemSchema.parse(JSON.parse(body));
  expect(problem.code).toBe(code);
  return problem;
}

/**
 * The response has this status and a JSON body that matches `schema`. Responses are not validated
 * at runtime, so this is what keeps the handlers, the shared schemas and the OpenAPI document in step.
 */
export async function expectJson<T extends z.ZodType>(res: Response, status: number, schema: T): Promise<z.output<T>> {
  const body = await res.text();
  expect(res.status, body).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  return schema.parse(JSON.parse(body));
}

/** JSON requests as one signed-in user (or anonymous, without headers). */
export function api(app: Requester, headers: Record<string, string> = {}) {
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: {
        ...headers,
        // State-changing requests must come from the app's own origin (CSRF check).
        origin: BASE_URL,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    get: (path: string) => send('GET', path),
    post: (path: string, body?: unknown) => send('POST', path, body),
    patch: (path: string, body: unknown) => send('PATCH', path, body),
    put: (path: string, body: unknown) => send('PUT', path, body),
    delete: (path: string) => send('DELETE', path),
  };
}

/** One signed-in client per role, for route tests that check who may do what. */
export async function roleClients(app: Requester, db: Db) {
  const as = async (role: 'read' | 'write' | 'admin') => api(app, (await loginAs(app, db, role)).headers);
  return { read: await as('read'), write: await as('write'), admin: await as('admin') };
}
