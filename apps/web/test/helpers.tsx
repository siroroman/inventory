import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createQueryClient } from '../src/lib/query.ts';
import { createAppRouter } from '../src/router.tsx';

/** Renders the whole app (router, query client without retries, toaster) at `path`. */
export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  // The retry policy has its own tests; here a failing call should fail at once, not after back-off.
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App router={router} queryClient={queryClient} />);
  return { queryClient, router };
}

/** Makes the window as wide as a desktop (true) or a phone (false, the default in tests). */
export function stubWideScreen(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('min-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
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

/** What `GET /me` answers for the signed-in user in the tests. */
export const me = {
  id: '0c6f5a4e-8f3b-4a8e-9a55-2f2b1b8a9c11',
  email: 'anna@example.test',
  name: 'Anna Nováková',
  role: 'write',
};

/** What any `/api/v1` call answers without a valid session. */
export const unauthenticated = () =>
  jsonResponse(
    { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthenticated' },
    { status: 401, problem: true },
  );
