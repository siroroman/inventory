import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { meQueryOptions } from './api';

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}

/**
 * Sends the user to the login page when the session ends while the app is open (it expired, or an
 * admin deactivated the account): any query or mutation that answers 401 forgets the cached user
 * and re-runs the route guards, which redirect to `/login?redirect=<current url>`.
 *
 * The session query itself failing with 401 is the normal "not signed in" answer of a first visit,
 * so it only counts when it had a user before. That also keeps the login page from looping.
 */
export function redirectOnExpiredSession(
  queryClient: QueryClient,
  router: { invalidate: () => Promise<void> },
) {
  let running: Promise<void> | undefined;
  const expired = () => {
    if (running) return;
    queryClient.removeQueries({ queryKey: meQueryOptions.queryKey });
    running = router.invalidate().finally(() => {
      running = undefined;
    });
  };

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    if (!isUnauthenticated(event.action.error)) return;
    const isSession = event.query.queryKey[0] === meQueryOptions.queryKey[0];
    if (isSession && event.query.state.data === undefined) return;
    expired();
  });
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') {
      if (isUnauthenticated(event.action.error)) expired();
    }
  });
}
