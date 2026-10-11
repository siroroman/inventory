import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { item, location, page, ref } from './fixtures.ts';
import { jsonResponse, me, openSection, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

/** Signed in, with the given answers for the two lists. */
function api(lists: { locations?: (request: Request) => Response; items?: (request: Request) => Response }) {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse(me),
    'GET /api/v1/locations': lists.locations ?? (() => page([])),
    'GET /api/v1/items': lists.items ?? (() => page([])),
  });
}

const listCalls = (calls: Request[], path: string) =>
  calls.filter((call) => new URL(call.url).pathname === path).map((call) => new URL(call.url).searchParams);

describe('home: items tab without a location', () => {
  it('shows the code alone on the card, without a dangling separator', async () => {
    api({ items: () => page([item({ location: null, path: [], name: 'Váha' })]) });
    renderApp('/?tab=items');
    expect(await screen.findByText('INV-00042')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).not.toHaveTextContent('·');
  });
});

describe('home: locations tab', () => {
  it('lists top-level locations with type, address and counts, under a heading with the total', async () => {
    api({ locations: () => page([location(), location({ name: 'Sklad Brno', type: ref('WAREHOUSE', 'Sklad'), address: null, itemCount: 1, childCount: 0 })], { total: 2 }) });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Lokality' })).toBeInTheDocument();
    expect(await screen.findByText('2 lokality')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Centrála Praha');
    expect(within(rows[0]!).getByText('Centrála')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Vinohradská 12, Praha');
    expect(rows[0]).toHaveTextContent('38 položek');
    expect(rows[0]).toHaveTextContent('4 podlokality');
    expect(rows[1]).toHaveTextContent('1 položka');
    expect(rows[1]).toHaveTextContent('0 podlokalit');
  });

  it('marks the Locations tab as selected and asks for the first page without a search', async () => {
    const calls = api({});
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Lokality', level: 2 })).toBeInTheDocument();
    await screen.findByText('Zatím tu nic není');
    expect(listCalls(calls, '/api/v1/locations')).toEqual([new URLSearchParams({ limit: '20' })]);
  });

  it('names the parents of a sub-location found by a search', async () => {
    api({ locations: () => page([location({ name: 'Teplá kuchyně', type: null, address: null, path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí'), ref('LOC-019', 'Teplá kuchyně')] })]) });
    renderApp('/?q=kuchyne');
    expect(await screen.findByText('Centrála Praha › Přízemí')).toBeInTheDocument();
  });

  it('says there is nothing yet when the list is empty', async () => {
    api({});
    renderApp('/');
    expect(await screen.findByText('Zatím tu nic není')).toBeInTheDocument();
    expect(screen.queryByText('Nic jsme nenašli')).not.toBeInTheDocument();
  });

  it('loads the next page with the cursor and hides the button after the last one', async () => {
    const calls = api({
      locations: (request) =>
        new URL(request.url).searchParams.get('cursor')
          ? page([location({ name: 'Zlín' })], { total: 2 })
          : page([location({ name: 'Brno' })], { nextCursor: 'abc', total: 2 }),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Zlín')).toBeInTheDocument();
    expect(screen.getByText('Brno')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Načíst další' })).not.toBeInTheDocument();
    expect(listCalls(calls, '/api/v1/locations').at(-1)?.get('cursor')).toBe('abc');
    expect(listCalls(calls, '/api/v1/locations').at(-1)?.get('limit')).toBe('20');
  });
});

describe('home: paging', () => {
  it('starts at the first page again after a search is cleared, not with every page loaded before', async () => {
    const calls = api({
      items: (request) => {
        const params = new URL(request.url).searchParams;
        if (params.get('q')) return page([item({ name: 'Nalezená položka' })]);
        return params.get('cursor')
          ? page([item({ name: 'Druhá strana' })], { total: 2 })
          : page([item({ name: 'První strana' })], { nextCursor: 'abc', total: 2 });
      },
    });
    renderApp('/?tab=items');
    await userEvent.click(await screen.findByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Druhá strana')).toBeInTheDocument();

    const box = screen.getByRole('searchbox', { name: 'Hledat položky' });
    await userEvent.type(box, 'nalezena');
    expect(await screen.findByText('Nalezená položka')).toBeInTheDocument();
    await userEvent.clear(box);

    expect(await screen.findByText('První strana')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Druhá strana')).not.toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Načíst další' })).toBeInTheDocument();
    // Fetched again from scratch, not served from what was loaded before.
    const firstPages = listCalls(calls, '/api/v1/items').filter((p) => !p.get('q') && !p.get('cursor'));
    expect(firstPages).toHaveLength(2);
  });
});

describe('home: desktop table', () => {
  it('shows locations as a table with column headings', async () => {
    stubWideScreen(true);
    api({ locations: () => page([location()]) });
    renderApp('/');

    const table = await screen.findByRole('table');
    const headings = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headings).toEqual(['Název', 'ID', 'Typ', 'Adresa', 'Podlokality', 'Položky']);
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Centrála Praha', 'LOC-001', 'Centrála', 'Vinohradská 12, Praha', '4 podlokality', '38 položek']);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows items as a table', async () => {
    stubWideScreen(true);
    api({ items: () => page([item()]) });
    renderApp('/?tab=items');

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Název',
      'ID',
      'Výrobce a model',
      'Lokalita',
    ]);
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual([
      'Konvektomat',
      'INV-00042',
      'Rational SCC 101',
      'Centrála Praha › Přízemí › Teplá kuchyně',
    ]);
  });

  it('uses cards, not a table, on a narrow screen', async () => {
    stubWideScreen(false);
    api({ locations: () => page([location()]) });
    renderApp('/');
    expect(await screen.findByRole('list')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('home: items tab', () => {
  it('lists items with ID, full location path, brand and model, from the tab in the URL', async () => {
    api({ items: () => page([item()]) });
    renderApp('/?tab=items');

    expect(await screen.findByRole('heading', { name: 'Položky', level: 2 })).toBeInTheDocument();
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Konvektomat');
    expect(row).toHaveTextContent('INV-00042');
    expect(row).toHaveTextContent('Centrála Praha › Přízemí › Teplá kuchyně');
    expect(row).toHaveTextContent('Rational SCC 101');
    expect(await screen.findByText('1 položka')).toBeInTheDocument();
  });

  it('copes with an item without a brand or a model', async () => {
    api({ items: () => page([item({ manufacturer: null, model: null })]) });
    renderApp('/?tab=items');
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Konvektomat');
    expect(row).not.toHaveTextContent('Rational');
  });
});

describe('home: search and tabs', () => {
  it('searches 300 ms after typing stops, keeps the text in the URL and asks the API once', async () => {
    const calls = api({});
    const { router } = renderApp('/?tab=items');
    await screen.findByText('Zatím tu nic není');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Hledat položky' }), 'EL-4821');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'items', q: 'EL-4821' }));
    await screen.findByText('Nic jsme nenašli');
    expect(listCalls(calls, '/api/v1/items').map((params) => params.get('q'))).toEqual([null, 'EL-4821']);
    expect(listCalls(calls, '/api/v1/items').every((params) => params.get('limit') === '20')).toBe(true);
  });

  it('replaces the history entry while typing, so Back leaves the screen in one step', async () => {
    api({});
    const { router } = renderApp('/');
    await screen.findByText('Zatím tu nic není');
    const before = router.history.length;
    await userEvent.type(screen.getByRole('searchbox', { name: 'Hledat lokality' }), 'brno');
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'brno' }));
    expect(router.history.length).toBe(before);
  });

  it('fills the box from the URL and searches for that text', async () => {
    const calls = api({});
    renderApp('/?q=vrtacka');
    expect(await screen.findByRole('searchbox', { name: 'Hledat lokality' })).toHaveValue('vrtacka');
    await screen.findByText('Nic jsme nenašli');
    expect(listCalls(calls, '/api/v1/locations')[0]?.get('q')).toBe('vrtacka');
  });

  it('keeps a numeric search text as the text it was typed as', async () => {
    const calls = api({});
    renderApp('/?tab=items&q=007');
    await screen.findByText('Nic jsme nenašli');
    expect(listCalls(calls, '/api/v1/items')[0]?.get('q')).toBe('007');
  });

  it('treats a blank search text in the URL as no search', async () => {
    const calls = api({});
    renderApp('/?q=%20%20');
    expect(await screen.findByText('Zatím tu nic není')).toBeInTheDocument();
    expect(listCalls(calls, '/api/v1/locations')[0]?.has('q')).toBe(false);
  });

  it('says nothing was found, with a tip, when a search has no match', async () => {
    api({});
    renderApp('/?q=nic');
    expect(await screen.findByText('Nic jsme nenašli')).toBeInTheDocument();
    expect(screen.getByText('Zkuste upravit hledaný text.')).toBeInTheDocument();
    expect(screen.queryByText('Zatím tu nic není')).not.toBeInTheDocument();
  });

  it('follows the URL when the search changes by itself (browser Back)', async () => {
    api({});
    const { router } = renderApp('/?q=brno');
    const box = await screen.findByRole('searchbox', { name: 'Hledat lokality' });
    await router.navigate({ to: '/', search: { q: 'praha' } });
    await waitFor(() => expect(box).toHaveValue('praha'));
  });

  it('switches tab through the URL and starts the other tab with an empty search', async () => {
    api({ items: () => page([item()]) });
    const { router } = renderApp('/?q=praha');
    await openSection('Položky');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'items' }));
    expect(await screen.findByRole('searchbox', { name: 'Hledat položky' })).toHaveValue('');
    await openSection('Lokality');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('ignores an unknown tab in the URL', async () => {
    api({});
    renderApp('/?tab=users');
    expect(await screen.findByRole('heading', { name: 'Lokality', level: 2 })).toBeInTheDocument();
  });
});

describe('home: search while an empty result is on screen', () => {
  it('shows the skeleton, not "nothing found", until the new search has answered', async () => {
    let release: (res: Response) => void = () => {};
    api({
      locations: (request) =>
        new URL(request.url).searchParams.get('q') === 'kon'
          ? (new Promise<Response>((resolve) => (release = resolve)) as never)
          : page([]),
    });
    renderApp('/?q=zzz');
    expect(await screen.findByText('Nic jsme nenašli')).toBeInTheDocument();

    const box = screen.getByRole('searchbox', { name: 'Hledat lokality' });
    await userEvent.clear(box);
    await userEvent.type(box, 'kon');
    expect(await screen.findByRole('status', { name: 'Načítání' })).toBeInTheDocument();
    expect(screen.queryByText('Nic jsme nenašli')).not.toBeInTheDocument();

    release(page([location({ name: 'Konírna' })]));
    expect(await screen.findByText('Konírna')).toBeInTheDocument();
  });
});

describe('home: loading and failure', () => {
  it('shows a skeleton until the first page arrives', async () => {
    let release: (res: Response) => void = () => {};
    api({ locations: () => new Promise<Response>((resolve) => (release = resolve)) as never });
    renderApp('/');
    expect(await screen.findByRole('status', { name: 'Načítání' })).toBeInTheDocument();
    release(page([location()]));
    expect(await screen.findByText('Centrála Praha')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Načítání' })).not.toBeInTheDocument();
  });

  it('shows the Czech error with a retry button, and the list after a successful retry', async () => {
    let failing = true;
    api({
      locations: () =>
        failing
          ? jsonResponse({ type: 'about:blank', title: 'Forbidden', status: 403, code: 'forbidden' }, { status: 403, problem: true })
          : page([location()]),
    });
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('K této akci nemáte oprávnění.');
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByText('Centrála Praha')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a server that cannot be reached', async () => {
    api({
      items: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp('/?tab=items');
    expect(await screen.findByRole('alert')).toHaveTextContent('Server není dostupný.');
  });
});

describe('home: archived records', () => {
  const archivedAt = '2026-05-01T00:00:00.000Z';

  it('lists the archived locations, marked, once "Zobrazit archivované" is ticked, and goes back when cleared', async () => {
    const calls = api({
      locations: (request) =>
        new URL(request.url).searchParams.get('archived') === 'true'
          ? page([location({ name: 'Stará pobočka', archivedAt })])
          : page([location({ name: 'Centrála Praha' })]),
    });
    const { router } = renderApp('/');
    await screen.findByText('Centrála Praha');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zobrazit archivované' }));
    expect(await screen.findByText('Stará pobočka')).toBeInTheDocument();
    expect(screen.queryByText('Centrála Praha')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Archivováno');
    expect(router.state.location.search).toEqual({ archived: true });
    expect(listCalls(calls, '/api/v1/locations').at(-1)?.get('archived')).toBe('true');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zobrazit archivované' }));
    expect(await screen.findByText('Centrála Praha')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it('lists the archived items from the URL, linking to their detail, and searches among them', async () => {
    const archived = item({ name: 'Stará váha', archivedAt });
    const calls = api({
      items: (request) => (new URL(request.url).searchParams.get('archived') === 'true' ? page([archived]) : page([])),
    });
    renderApp('/?tab=items&archived=true');

    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Stará váha');
    expect(row).toHaveTextContent('Archivováno');
    expect(screen.getByRole('checkbox', { name: 'Zobrazit archivované' })).toBeChecked();
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/items/${archived.id}`);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Hledat položky' }), 'vaha');
    await waitFor(() =>
      expect(Object.fromEntries(listCalls(calls, '/api/v1/items').at(-1) ?? [])).toEqual({ archived: 'true', q: 'vaha', limit: '20' }),
    );
  });

  it('says there are no archived records when there are none', async () => {
    api({});
    renderApp('/?archived=true');
    expect(await screen.findByText('Žádné archivované lokality')).toBeInTheDocument();
  });

  it('does not take the switch to the other tab, and ignores a wrong value in the URL', async () => {
    api({});
    const { router } = renderApp('/?archived=true');
    await screen.findByText('Žádné archivované lokality');
    await openSection('Položky');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'items' }));
    expect(screen.getByRole('checkbox', { name: 'Zobrazit archivované' })).not.toBeChecked();

    await router.navigate({ to: '/', search: { archived: 'maybe' } as never });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Zobrazit archivované' })).not.toBeChecked());
  });
});
