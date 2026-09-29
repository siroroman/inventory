import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { createQueryClient } from '../src/lib/query.ts';
import { createAppRouter } from '../src/router.tsx';

/** Renders the whole app (router, query client, toaster) at `path`. */
export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App router={router} queryClient={queryClient} />);
  return { queryClient, router };
}

/** A JSON `Response`, the way the API answers (`application/problem+json` for errors). */
export function jsonResponse(body: unknown, init: ResponseInit & { problem?: boolean } = {}) {
  const { problem, ...rest } = init;
  return new Response(JSON.stringify(body), {
    ...rest,
    headers: { 'content-type': problem ? 'application/problem+json' : 'application/json' },
  });
}
