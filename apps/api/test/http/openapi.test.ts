import { describe, expect, it } from 'vitest';
import { publicPaths } from '../../src/app.ts';
import { BASE_URL, createTestApp, loginAs } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';

const db = useTestDb();

type Operation = {
  security?: unknown[];
  'x-min-role'?: string;
  responses?: Record<string, unknown>;
  tags?: string[];
  summary?: string;
  parameters?: unknown[];
  requestBody?: unknown;
};
type Doc = {
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown> };
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const SOME_UUID = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

async function loadDoc() {
  const { app } = createTestApp(db().app);
  const { headers } = await loginAs(app, db().app, 'read');
  const res = await app.request('/api/v1/openapi.json', { headers });
  return { app, doc: (await res.json()) as Doc };
}

describe('OpenAPI document', () => {
  it('declares the cookie security scheme', async () => {
    const { doc } = await loadDoc();
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({ type: 'apiKey', in: 'cookie' });
  });

  it('describes GET /me with its role and the standard error responses', async () => {
    const { doc } = await loadDoc();
    const me = doc.paths['/api/v1/me']?.get;
    expect(me?.['x-min-role']).toBe('read');
    expect(me?.security).toEqual([{ cookieAuth: [] }]);
    expect(Object.keys(me?.responses ?? {})).toEqual(expect.arrayContaining(['200', '401', '403']));
  });
});

// Every operation must be findable and documented in the same way, so the OpenAPI document stays
// a usable reference for the SPA and for a generated native client later.
describe('operation documentation', () => {
  it('has tags and a summary, and documents 400 wherever input is validated', async () => {
    const { doc } = await loadDoc();
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const label = `${method.toUpperCase()} ${path}`;
        expect(op.tags?.length, `${label} has no tags`).toBeGreaterThan(0);
        expect(op.summary, `${label} has no summary`).toBeTruthy();
        if ((op.parameters?.length ?? 0) > 0 || op.requestBody) {
          expect(Object.keys(op.responses ?? {}), `${label} does not document 400`).toContain('400');
        }
      }
    }
  });
});

// Guards against a route that was added without a role or left open. Every operation must either
// be listed as public or declare a role, and every non-public one must refuse an anonymous caller.
describe('auth matrix', () => {
  it('has a role on every operation that is not public, and 401 for anonymous callers', async () => {
    const { app, doc } = await loadDoc();
    const checked: string[] = [];

    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const label = `${method.toUpperCase()} ${path}`;
        const url = path.replace(/\{[^}]+\}/g, SOME_UUID);

        if (publicPaths.has(path)) {
          expect(op.security, `${label} is public but declares security`).toEqual([]);
          continue;
        }
        expect(op['x-min-role'], `${label} has no x-min-role`).toBeDefined();
        expect(op.security, `${label} does not declare cookieAuth`).toEqual([{ cookieAuth: [] }]);

        // Same origin, so the CSRF check passes and it is authentication that answers.
        const res = await app.request(url, { method: method.toUpperCase(), headers: { origin: BASE_URL } });
        expect(res.status, `${label} answered an anonymous caller`).toBe(401);
        checked.push(label);
      }
    }
    expect(checked).toContain('GET /api/v1/me');
  });

  it('lists only paths that exist in the public set as public', async () => {
    const { app, doc } = await loadDoc();
    for (const path of publicPaths) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
    }
    // Paths the document calls public must be in the set the middleware skips.
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        if (item[method] && (item[method].security ?? []).length === 0) expect(publicPaths.has(path), path).toBe(true);
      }
    }
  });

  it('serves the authenticated routes to a signed-in user', async () => {
    const { app } = await loadDoc();
    const { headers } = await loginAs(app, db().app, 'read');
    expect((await app.request('/api/v1/me', { headers })).status).toBe(200);
  });
});
