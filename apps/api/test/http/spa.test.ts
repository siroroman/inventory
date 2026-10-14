import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';

const db = useTestDb();

// A stand-in for apps/web/dist.
const root = mkdtempSync(join(tmpdir(), 'spa-'));
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'index.html'), '<!doctype html><title>SPA</title>');
writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
writeFileSync(join(root, 'favicon.svg'), '<svg/>');
// What precompress.mjs leaves next to a text file.
const bundle = `console.log(${JSON.stringify('x'.repeat(2000))})`;
writeFileSync(join(root, 'assets', 'big-abc123.js'), bundle);
writeFileSync(join(root, 'assets', 'big-abc123.js.br'), brotliCompressSync(bundle));
writeFileSync(join(root, 'assets', 'big-abc123.js.gz'), gzipSync(bundle));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const setup = (options: { staticRoot?: string } = { staticRoot: root }) => createTestApp(db().app, options).app;

describe('serving the SPA', () => {
  it('serves index.html at / with revalidation and the security headers', async () => {
    const res = await setup().request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await res.text()).toContain('<title>SPA</title>');
  });

  it('answers a deep link with index.html so the router can take over', async () => {
    const res = await setup().request('/locations/0b8e7f3c-2d1a-4c5b-9e6f-7a8b9c0d1e2f/edit?x=1');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>SPA</title>');
  });

  it('caches hashed assets for good and other files only with revalidation', async () => {
    const asset = await setup().request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await asset.text()).toBe('console.log(1)');

    const icon = await setup().request('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves the precompressed copy the browser accepts, with the right headers', async () => {
    const br = await setup().request('/assets/big-abc123.js', { headers: { 'accept-encoding': 'gzip, br' } });
    expect(br.status).toBe(200);
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toContain('Accept-Encoding');
    expect(br.headers.get('content-type')).toMatch(/javascript/);
    expect(br.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(bundle);

    const gz = await setup().request('/assets/big-abc123.js', { headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers.get('content-encoding')).toBe('gzip');

    const plain = await setup().request('/assets/big-abc123.js');
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toBe(bundle);
  });

  it('answers 404 for a missing asset instead of the page', async () => {
    const res = await setup().request('/assets/index-gone.js');
    expect(res.status).toBe(404);
  });

  it('never answers /api paths with the SPA', async () => {
    const v1 = await setup().request('/api/v1/nothing-here');
    expect(v1.status).toBe(401);
    const other = await setup().request('/api/nothing-here');
    expect(other.status).toBe(404);
    expect(other.headers.get('content-type')).not.toMatch(/text\/html/);
  });

  it('refuses paths that climb out of the root', async () => {
    const res = await setup().request('/..%2f..%2fetc%2fpasswd');
    expect(await res.text()).not.toContain('root:');
  });

  it('serves nothing outside /api without a static root', async () => {
    const res = await setup({}).request('/');
    expect(res.status).toBe(404);
  });
});
