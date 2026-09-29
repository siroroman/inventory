import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { RouteError, RouteNotFound } from '@/components/route-states';
import { routeTree } from './routeTree.gen.ts';

export function createAppRouter({
  queryClient,
  history,
}: {
  queryClient: QueryClient;
  /** Tests pass a memory history; the browser uses the default. */
  history?: RouterHistory;
}) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
