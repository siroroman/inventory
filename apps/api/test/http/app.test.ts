import { describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers/db.ts';
import { createTestApp, loginAs } from '../helpers/app.ts';

const db = useTestDb();
const setup = (options?: { isProduction?: boolean }) => createTestApp(db().app, options);

describe('GET /api/v1/health', () => {
  it('answers without authentication', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('request id and access log', () => {
  it('returns a request id and logs one line per request', async () => {
    const { app, logs } = setup();
    const res = await app.request('/api/v1/health');
    const id = res.headers.get('x-request-id');
    expect(id).toBeTruthy();
    expect(logs).toEqual([
      expect.objectContaining({
        severity: 'INFO',
        message: 'request',
        requestId: id,
        method: 'GET',
        path: '/api/v1/health',
        status: 200,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('keeps the query string and headers out of the log', async () => {
    const { app, logs } = setup();
    await app.request('/api/v1/health?q=secret-search', { headers: { cookie: 'session=abc', authorization: 'Bearer t' } });
    expect(JSON.stringify(logs)).not.toMatch(/secret-search|session=abc|Bearer/);
  });
});

describe('security headers', () => {
  it('sets CSP, nosniff and Referrer-Policy', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('frame-src https://storage.googleapis.com blob:');
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('sends HSTS in production only', async () => {
    const dev = await setup().app.request('/api/v1/health');
    expect(dev.headers.get('strict-transport-security')).toBeNull();
    const prod = await setup({ isProduction: true }).app.request('/api/v1/health');
    expect(prod.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);
  });
});

describe('caching', () => {
  it('forbids caching of every /api/v1 response, errors included', async () => {
    const { app } = setup();
    const { headers } = await loginAs(app, db().app, 'read');
    for (const [path, init] of [
      ['/api/v1/health', {}],
      ['/api/v1/me', { headers }],
      ['/api/v1/me', {}],
      ['/api/v1/nothing-here', { headers }],
    ] as const) {
      const res = await app.request(path, init);
      expect(res.headers.get('cache-control'), `${path} ${res.status}`).toBe('no-store');
    }
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('describes the API as OpenAPI 3.1', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
  });
});

describe('request size limit', () => {
  it('rejects a body over 1 MB with a 413 problem', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/health', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) },
      body: '{}',
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await res.json()).toMatchObject({ code: 'payload_too_large', status: 413 });
  });
});

describe('unknown routes', () => {
  it('outside /api/v1 return a 404 problem', async () => {
    const { app } = setup();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });
});
