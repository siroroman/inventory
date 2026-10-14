import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { RouteError, RouteNotFound, RoutePending } from '@/components/route-states';
import { redirectOnExpiredSession } from '@/features/auth/session-expiry';
import { routeTree } from './routeTree.gen.ts';

export function createAppRouter({
  queryClient,
  history,
}: {
  queryClient: QueryClient;
  /** Tests pass a memory history; the browser uses the default. */
  history?: RouterHistory;
}) {
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
    // Skeleton instead of a blank page while a route (or the session check) is slow; not shown for
    // fast loads, and kept for a moment once shown so it does not flicker.
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
  });
  redirectOnExpiredSession(queryClient, router);
  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
  /** Set by the route guard's redirect to /login: the session was just found missing. */
  interface HistoryState {
    anonymous?: boolean;
  }
}
