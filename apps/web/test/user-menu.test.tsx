import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from './helpers.tsx';

const me = { id: '0c6f5a4e-8f3b-4a8e-9a55-2f2b1b8a9c11', email: 'anna@example.test', name: 'Anna Nováková', role: 'write' };

const unauthenticated = () =>
  jsonResponse(
    { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthenticated' },
    { status: 401, problem: true },
  );

async function openMenu() {
  const user = userEvent.setup();
  const trigger = await screen.findByRole('button', { name: 'Uživatelské menu' });
  await user.click(trigger);
  return user;
}

describe('user menu', () => {
  it('shows the initials and, when opened, the name, e-mail and role', async () => {
    stubApi({ 'GET /api/v1/me': () => jsonResponse(me) });
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Uživatelské menu' })).toHaveTextContent('AN');
    await openMenu();
    expect(await screen.findByText('Anna Nováková')).toBeInTheDocument();
    expect(screen.getByText('anna@example.test')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('signs out, forgets the cached user and lands on the login page', async () => {
    let signedIn = true;
    const calls = stubApi({
      'GET /api/v1/me': () => (signedIn ? jsonResponse(me) : unauthenticated()),
      'POST /api/auth/sign-out': () => {
        signedIn = false;
        return jsonResponse({ success: true });
      },
    });
    const { router, queryClient } = renderApp('/');
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Odhlásit se' }));
    expect(await screen.findByRole('button', { name: 'Přihlásit se' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/auth/sign-out'))).toBe(true);
  });

  it('stays signed in and says so when sign-out fails', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'POST /api/auth/sign-out': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const { router } = renderApp('/');
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Odhlásit se' }));
    expect(await screen.findByText(/Server není dostupný/)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
