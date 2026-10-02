import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { location, page } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubScreenWidth, stubWideScreen } from './helpers.tsx';

function api() {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse(me),
    'GET /api/v1/locations': () => page([location()]),
    'GET /api/v1/items': () => page([]),
    'GET /api/v1/service-records': () => page([]),
    'GET /api/v1/manufacturers': () => page([]),
  });
}

describe('home: side menu on desktop', () => {
  it('replaces the top bar and the tabs with the three lists and the user', async () => {
    stubWideScreen(true);
    api();
    renderApp('/');

    const nav = await screen.findByRole('navigation', { name: 'Hlavní navigace' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Lokality', 'Položky', 'Údržba']);
    expect(within(nav).getByRole('link', { name: 'Lokality' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Položky' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    // The one user menu is the one in the side menu, with name and role beside the avatar.
    expect(screen.getAllByRole('button', { name: /Anna Nováková/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Anna Nováková/ })).toHaveTextContent('Editor');
    // The list sits under its heading with the search and the Add button in one place.
    expect(await screen.findByRole('heading', { name: 'Lokality', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Hledat lokality' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Přidat lokalitu/ })).toBeInTheDocument();
  });

  it('marks the list of the URL and switches lists with a fresh search', async () => {
    stubWideScreen(true);
    api();
    const { router } = renderApp('/?tab=maintenance&q=filtr&archived=true');

    const nav = await screen.findByRole('navigation', { name: 'Hlavní navigace' });
    expect(within(nav).getByRole('link', { name: 'Údržba' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(within(nav).getByRole('link', { name: 'Položky' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'items' }));
    expect(within(nav).getByRole('link', { name: 'Položky' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(within(nav).getByRole('link', { name: 'Lokality' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('keeps the top bar on the other screens', async () => {
    stubWideScreen(true);
    api();
    renderApp('/items/new');

    expect(await screen.findByRole('banner')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Hlavní navigace' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uživatelské menu' })).toBeInTheDocument();
  });

  it('signs out from the menu in the side menu', async () => {
    stubWideScreen(true);
    const calls = api();
    renderApp('/');

    await userEvent.click(await screen.findByRole('button', { name: /Anna Nováková/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Odhlásit se' }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/auth/sign-out'))).toBe(true),
    );
  });
});

describe('home: narrow screen', () => {
  it('keeps the top bar and the tabs, without a side menu', async () => {
    stubWideScreen(false);
    api();
    renderApp('/');

    expect(await screen.findByRole('tablist', { name: 'Přehled' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Hlavní navigace' })).not.toBeInTheDocument();
  });

  it('keeps the top bar and the tabs at tablet width, with the table', async () => {
    stubScreenWidth(800);
    api();
    renderApp('/');

    expect(await screen.findByRole('tablist', { name: 'Přehled' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Hlavní navigace' })).not.toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
