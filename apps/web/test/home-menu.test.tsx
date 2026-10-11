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
    'GET /api/v1/service-providers': () => page([]),
    'GET /api/v1/manufacturers': () => page([]),
    'GET /api/v1/inventories': () => page([]),
  });
}

const sections = ['Lokality', 'Položky', 'Údržba', 'Dodavatelé', 'Inventura', 'Štítky'];

describe('home: hamburger menu on a phone', () => {
  it('replaces the tab bar with a button left of the logo', async () => {
    stubWideScreen(false);
    api();
    renderApp('/');

    const button = await screen.findByRole('button', { name: 'Menu' });
    const bar = screen.getByRole('banner');
    // First in the bar, before the logo link and the user menu.
    expect(within(bar).getAllByRole('button')[0]).toBe(button);
    expect(button.compareDocumentPosition(within(bar).getByRole('link', { name: /Správa majetku/ }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists the six sections and marks the current one', async () => {
    stubWideScreen(false);
    api();
    renderApp('/?tab=maintenance');

    const button = await screen.findByRole('button', { name: 'Menu' });
    await userEvent.click(button);
    const menu = await screen.findByRole('menu', { name: 'Menu' });
    const entries = within(menu).getAllByRole('menuitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(sections);
    expect(within(menu).getByRole('menuitem', { name: 'Údržba' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('menuitem', { name: 'Položky' })).not.toHaveAttribute('aria-current');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('goes to a section with a fresh search, closes and shows its heading', async () => {
    stubWideScreen(false);
    api();
    const { router } = renderApp('/?q=praha&archived=true');

    const button = await screen.findByRole('button', { name: 'Menu' });
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Štítky' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'labels' }));
    expect(await screen.findByRole('heading', { name: 'Tisk štítků', level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('goes back to the locations by leaving the tab out of the URL', async () => {
    stubWideScreen(false);
    api();
    const { router } = renderApp('/?tab=labels');
    await screen.findByRole('heading', { name: 'Tisk štítků', level: 2 });

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Lokality' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByRole('heading', { name: 'Lokality', level: 2 })).toBeInTheDocument();
  });

  it('closes on Escape and gives the focus back to the button', async () => {
    stubWideScreen(false);
    api();
    renderApp('/');

    const button = await screen.findByRole('button', { name: 'Menu' });
    await userEvent.click(button);
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it('opens from the keyboard and chooses with Enter', async () => {
    stubWideScreen(false);
    api();
    const { router } = renderApp('/');

    const button = await screen.findByRole('button', { name: 'Menu' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'items' }));
  });

  it('is not on the other screens, which keep their top bar', async () => {
    stubWideScreen(false);
    api();
    renderApp('/items/new');

    expect(await screen.findByRole('banner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('is there at tablet width too, below the side menu', async () => {
    stubScreenWidth(1023);
    api();
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });
});

describe('home: Štítky section', () => {
  it('is the sixth link of the side menu and shows its heading on desktop', async () => {
    stubWideScreen(true);
    api();
    const { router } = renderApp('/');

    const nav = await screen.findByRole('navigation', { name: 'Hlavní navigace' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Štítky' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'labels' }));
    expect(within(nav).getByRole('link', { name: 'Štítky' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Tisk štítků', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vyberte lokalitu' })).toBeInTheDocument();
  });

  it('opens from the URL, for every role', async () => {
    stubWideScreen(false);
    stubApi({
      'GET /api/v1/me': () => jsonResponse({ ...me, role: 'read' }),
    });
    renderApp('/?tab=labels');
    expect(await screen.findByRole('heading', { name: 'Tisk štítků', level: 2 })).toBeInTheDocument();
  });
});
