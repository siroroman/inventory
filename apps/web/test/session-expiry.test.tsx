import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api.ts';
import { jsonResponse, me, renderApp, stubApi, unauthenticated } from './helpers.tsx';

/** A signed-in visitor whose session can be ended from the test. */
function endableSession() {
  let signedIn = true;
  stubApi({ 'GET /api/v1/me': () => (signedIn ? jsonResponse(me) : unauthenticated()) });
  return () => {
    signedIn = false;
  };
}

describe('session that ends while the app is open', () => {
  it('sends the user to the login page, remembering the URL, when a query answers 401', async () => {
    const endSession = endableSession();
    const { router, queryClient } = renderApp('/?tab=items');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();

    endSession();
    await queryClient
      .fetchQuery({
        queryKey: ['locations'],
        queryFn: () => Promise.reject(new ApiError('unauthenticated', 401)),
        retry: false,
      })
      .catch(() => {});

    expect(await screen.findByRole('button', { name: 'Přihlásit se' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/?tab=items' });
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });

  it('does the same for a mutation', async () => {
    const endSession = endableSession();
    const { router, queryClient } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();

    endSession();
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: () => Promise.reject(new ApiError('unauthenticated', 401)),
        meta: { silentError: true },
      })
      .execute(undefined)
      .catch(() => {});

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('leaves other errors alone', async () => {
    endableSession();
    const { router, queryClient } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();

    await queryClient
      .fetchQuery({
        queryKey: ['locations'],
        queryFn: () => Promise.reject(new ApiError('forbidden', 403)),
        retry: false,
      })
      .catch(() => {});

    expect(router.state.location.pathname).toBe('/');
  });
});
