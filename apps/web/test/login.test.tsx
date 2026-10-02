import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, me, renderApp, stubApi, unauthenticated } from './helpers.tsx';

/** The API of a visitor who is anonymous until the sign-in call succeeds. */
function sessionApi(signInAnswer: () => Response | Promise<Response> = () => jsonResponse({ token: 't' })) {
  let signedIn = false;
  return stubApi({
    'GET /api/v1/me': () => (signedIn ? jsonResponse(me) : unauthenticated()),
    'POST /api/auth/sign-in/email': async () => {
      const answer = await signInAnswer();
      signedIn = answer.ok;
      return answer;
    },
  });
}
const wrongPassword = () =>
  jsonResponse({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, { status: 401 });
const noSession = () =>
  jsonResponse({ code: 'FAILED_TO_CREATE_SESSION', message: 'Failed to create session' }, { status: 401 });

async function fillAndSubmit(email = 'anna@example.test', password = 'tajne-heslo') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail'), email);
  await user.type(screen.getByLabelText('Heslo'), password);
  await user.click(screen.getByRole('button', { name: 'Přihlásit se' }));
}

describe('login screen', () => {
  it('shows the app name, both fields and a sign-in button', async () => {
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Správa majetku' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Přihlásit se' })).toBeEnabled();
  });

  it('asks for the missing fields without sending anything', async () => {
    const calls = sessionApi();
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Přihlásit se' }));
    expect(await screen.findByText('Zadejte e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Zadejte heslo.')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.filter((call) => call.url.includes('/sign-in'))).toHaveLength(0);
  });

  it('rejects an address that is not an e-mail, without sending anything', async () => {
    const calls = sessionApi();
    renderApp('/login');
    await fillAndSubmit('anna');
    expect(await screen.findByText('Zadejte platný e-mail.')).toBeInTheDocument();
    expect(calls.filter((call) => call.url.includes('/sign-in'))).toHaveLength(0);
  });

  it('sends the trimmed credentials and goes home', async () => {
    const calls = sessionApi();
    const { router } = renderApp('/login');
    await fillAndSubmit('  anna@example.test ');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const signIn = calls.find((call) => call.url.endsWith('/sign-in/email'));
    expect(await signIn?.json()).toEqual({ email: 'anna@example.test', password: 'tajne-heslo' });
  });

  it('returns to the page that was asked for, query included', async () => {
    sessionApi();
    const { router } = renderApp('/login?redirect=%2Flocations%3Fq%3Dvrtacka');
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/locations'));
    expect(router.state.location.search).toEqual({ q: 'vrtacka' });
  });

  it('ignores a redirect to another site', async () => {
    sessionApi();
    const { router } = renderApp('/login?redirect=%2F%2Fevil.example');
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.href).toBe('/');
  });

  it('says so when the e-mail or password is wrong, and stays on the form', async () => {
    sessionApi(wrongPassword);
    const { router } = renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nesprávný e-mail nebo heslo.');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByRole('button', { name: 'Přihlásit se' })).toBeEnabled();
  });

  it('tells a deactivated account that it has no access', async () => {
    sessionApi(noSession);
    renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tento účet nemá do aplikace přístup. Obraťte se na správce.',
    );
  });

  it('says so when the server cannot be reached', async () => {
    sessionApi(() => {
      throw new TypeError('Failed to fetch');
    });
    renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Server není dostupný.');
  });

  it('disables the button while signing in, so a second click cannot double-submit', async () => {
    let release: (res: Response) => void = () => {};
    const calls = sessionApi(() => new Promise<Response>((resolve) => (release = resolve)));
    renderApp('/login');
    await fillAndSubmit();
    const button = await screen.findByRole('button', { name: 'Přihlašuji…' });
    expect(button).toBeDisabled();
    release(jsonResponse({ token: 't' }));
    await waitFor(() => expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument());
    expect(calls.filter((call) => call.url.endsWith('/sign-in/email'))).toHaveLength(1);
  });
});
