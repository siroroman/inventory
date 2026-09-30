import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';

const valid = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/inventory',
  BETTER_AUTH_URL: 'http://localhost:8080',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('parseConfig', () => {
  it('applies defaults', () => {
    const config = parseConfig(valid);
    expect(config).toMatchObject({ env: 'development', isProduction: false, port: 8080 });
    expect(config.auth.google).toBeUndefined();
    expect(config.staticDir).toBeUndefined();
  });

  it('reads the directory of the built SPA', () => {
    expect(parseConfig({ ...valid, STATIC_DIR: '/app/apps/web/dist' }).staticDir).toBe('/app/apps/web/dist');
  });

  it('reads production, the port and Google credentials', () => {
    const config = parseConfig({
      ...valid,
      NODE_ENV: 'production',
      PORT: '3000',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    expect(config).toMatchObject({ isProduction: true, port: 3000 });
    expect(config.auth.google).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('names every missing variable', () => {
    expect(() => parseConfig({})).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_URL[\s\S]*BETTER_AUTH_SECRET/);
  });

  it('rejects a short secret without echoing it', () => {
    const attempt = () => parseConfig({ ...valid, BETTER_AUTH_SECRET: 'short-secret' });
    expect(attempt).toThrow(/BETTER_AUTH_SECRET/);
    expect(attempt).not.toThrow(/short-secret/);
  });

  it('rejects an unknown environment and a bad port', () => {
    expect(() => parseConfig({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => parseConfig({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });

  it('requires the Google credentials together', () => {
    expect(() => parseConfig({ ...valid, GOOGLE_CLIENT_ID: 'id' })).toThrow(/set together/);
    expect(() => parseConfig({ ...valid, GOOGLE_CLIENT_SECRET: 'secret' })).toThrow(/set together/);
  });
});
