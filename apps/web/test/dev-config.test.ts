import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.ts';

describe('local development config', () => {
  // The API only accepts requests whose Origin is BETTER_AUTH_URL. In development the browser's origin
  // is the Vite dev server, so a template pointing anywhere else makes sign-in and sign-out fail.
  it('has .env.example trust the Vite dev server origin', () => {
    const example = readFileSync(path.resolve(import.meta.dirname, '../../../.env.example'), 'utf8');
    const url = /^BETTER_AUTH_URL=(.+)$/m.exec(example)?.[1];
    expect(url).toBeDefined();
    expect(new URL(url!).origin).toBe(`http://localhost:${viteConfig.server?.port}`);
  });
});
