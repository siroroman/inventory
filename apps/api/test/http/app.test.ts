import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app.ts';

describe('GET /api/v1/health', () => {
  it('answers without authentication', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('request id and access log', () => {
  it('returns a request id and logs one line per request', async () => {
    const { app, logs } = createTestApp();
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
    const { app, logs } = createTestApp();
    await app.request('/api/v1/health?q=secret-search', { headers: { cookie: 'session=abc', authorization: 'Bearer t' } });
    expect(JSON.stringify(logs)).not.toMatch(/secret-search|session=abc|Bearer/);
  });
});

describe('security headers', () => {
  it('sets CSP, nosniff and Referrer-Policy', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('sends HSTS in production only', async () => {
    const dev = await createTestApp().app.request('/api/v1/health');
    expect(dev.headers.get('strict-transport-security')).toBeNull();
    const prod = await createTestApp({ isProduction: true }).app.request('/api/v1/health');
    expect(prod.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('describes the API as OpenAPI 3.1', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
  });
});
