import { queryOptions } from '@tanstack/react-query';
import { ApiError, api, unwrap } from '@/lib/api';

/** The signed-in user. Its query is the session: a 401 here means "not signed in". */
export const meQueryOptions = queryOptions({
  queryKey: ['me'],
  queryFn: () => unwrap(api.api.v1.me.$get()),
});

/**
 * Better Auth answers `{ code, message }`, not problem+json, so these two calls do not go through
 * `unwrap`. A wrong password and a deactivated account are both 401 and differ only by `code`.
 */
async function authRequest(path: string, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  if (res.ok) return;

  const { code } = (await res.json().catch(() => ({}))) as { code?: unknown };
  if (res.status === 429) throw new ApiError('rate_limited', res.status);
  if (res.status === 401 && code === 'FAILED_TO_CREATE_SESSION') {
    throw new ApiError('no_access', res.status);
  }
  if (res.status === 401) throw new ApiError('invalid_credentials', res.status);
  throw new ApiError('unexpected', res.status);
}

export function signIn(credentials: { email: string; password: string }) {
  return authRequest('sign-in/email', credentials);
}

export function signOut() {
  return authRequest('sign-out', {});
}
