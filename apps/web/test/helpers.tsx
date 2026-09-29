import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
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

type Handler = (request: Request) => Response | Promise<Response>;

/**
 * Replaces the global `fetch` for one test (setup.ts restores it). `routes` maps "METHOD /path" to
 * an answer; a request nobody stubbed gets a 501 so the test fails visibly instead of hanging.
 */
export function stubApi(routes: Record<string, Handler>) {
  const calls: Request[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(input instanceof Request ? input.url : String(input), 'http://localhost'), init);
    calls.push(request);
    const handler = routes[`${request.method} ${new URL(request.url).pathname}`];
    return handler ? handler(request) : new Response('unstubbed request', { status: 501 });
  });
  return calls;
}
