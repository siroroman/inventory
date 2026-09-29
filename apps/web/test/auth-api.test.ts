import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, signOut } from '../src/features/auth/api.ts';
import { ApiError } from '../src/lib/api.ts';
import { problemMessage } from '../src/lib/problem.ts';
import { jsonResponse } from './helpers.tsx';

function stubFetch(respond: () => Response | Promise<Response>) {
  const fetchStub = vi.fn<typeof fetch>(async () => respond());
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

afterEach(() => vi.unstubAllGlobals());

describe('signIn', () => {
  it('posts the credentials as JSON to Better Auth', async () => {
    const fetchStub = stubFetch(() => jsonResponse({ token: 't' }));
    await signIn({ email: 'a@example.test', password: 'secret' });
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/sign-in/email');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@example.test', password: 'secret' });
  });

  it('turns a wrong password into invalid_credentials', async () => {
    stubFetch(() =>
      jsonResponse({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, { status: 401 }),
    );
    const error = await signIn({ email: 'a@example.test', password: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_credentials', status: 401 });
    expect(problemMessage(error)).toBe('Nesprávný e-mail nebo heslo.');
  });

  it('turns a refused session (deactivated account) into no_access', async () => {
    stubFetch(() =>
      jsonResponse({ code: 'FAILED_TO_CREATE_SESSION', message: 'Failed to create session' }, { status: 401 }),
    );
    const error = await signIn({ email: 'a@example.test', password: 'x' }).catch((e) => e);
    expect(error).toMatchObject({ code: 'no_access', status: 401 });
  });

  it('maps rate limiting, other failures and a missing server', async () => {
    stubFetch(() => jsonResponse({}, { status: 429 }));
    expect(await signIn({ email: 'a@example.test', password: 'x' }).catch((e) => e)).toMatchObject({
      code: 'rate_limited',
    });

    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await signIn({ email: 'a@example.test', password: 'x' }).catch((e) => e)).toMatchObject({
      code: 'unexpected',
      status: 502,
    });

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await signIn({ email: 'a@example.test', password: 'x' }).catch((e) => e)).toMatchObject({
      code: 'network',
    });
  });
});

describe('signOut', () => {
  it('posts an empty JSON body to the sign-out endpoint', async () => {
    const fetchStub = stubFetch(() => jsonResponse({ success: true }));
    await signOut();
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/sign-out');
    expect(init?.body).toBe('{}');
  });

  it('fails with the mapped error when the call does not go through', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await signOut().catch((e) => e)).toMatchObject({ code: 'network' });
  });
});
