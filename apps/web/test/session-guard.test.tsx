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

describe('route guard', () => {
  it('sends an anonymous visitor to the login page and remembers where they wanted to go', async () => {
    stubApi({ 'GET /api/v1/me': unauthenticated });
    const { router } = renderApp('/?tab=items');
    expect(await screen.findByRole('button', { name: 'Přihlásit se' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/?tab=items' });
    expect(screen.queryByRole('heading', { name: 'Přehled' })).not.toBeInTheDocument();
  });

  it('signs in and lands on the page that was asked for', async () => {
    let signedIn = false;
    stubApi({
      'GET /api/v1/me': () => (signedIn ? jsonResponse(me) : unauthenticated()),
      'POST /api/auth/sign-in/email': () => {
        signedIn = true;
        return jsonResponse({ token: 't' });
      },
    });
    const { router } = renderApp('/?tab=items');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'anna@example.test');
    await user.type(screen.getByLabelText('Heslo'), 'tajne-heslo');
    await user.click(screen.getByRole('button', { name: 'Přihlásit se' }));
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();
    expect(router.state.location.href).toBe('/?tab=items');
  });

  it('shows the screen to a signed-in user', async () => {
    stubApi({ 'GET /api/v1/me': () => jsonResponse(me) });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps a signed-in user off the login page', async () => {
    stubApi({ 'GET /api/v1/me': () => jsonResponse(me) });
    const { router } = renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('does not mistake an unreachable server for a sign-out, and can retry', async () => {
    let up = false;
    stubApi({
      'GET /api/v1/me': () => {
        if (!up) throw new TypeError('Failed to fetch');
        return jsonResponse(me);
      },
    });
    const { router } = renderApp('/');
    expect(await screen.findByText(/Server není dostupný/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();
  });

  it('shows the login form when the server is down at the login page', async () => {
    stubApi({
      'GET /api/v1/me': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp('/login');
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toBeInTheDocument());
  });
});
