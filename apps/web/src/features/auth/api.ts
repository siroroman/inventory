import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { ApiError, api, unwrap } from '@/lib/api';

/** The signed-in user. Its query is the session: a 401 here means "not signed in". */
export const meQueryOptions = queryOptions({
  queryKey: ['me'],
  queryFn: () => unwrap(api.api.v1.me.$get()),
});

/**
 * The signed-in user, from the cache while it is fresh (30 s) and from the server after that, so
 * an expired or deactivated session is noticed on the next navigation. No retries: the caller is
 * a route guard, and its error screen has a retry button.
 */
export function currentUser(queryClient: QueryClient) {
  return queryClient.fetchQuery({ ...meQueryOptions, retry: false });
}

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
