import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const ref = (code: string, name: string) => ({ id: crypto.randomUUID(), code, name });
const record = { version: 1, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

function location(over: Record<string, unknown> = {}) {
  return {
    ...record,
    id: crypto.randomUUID(),
    code: 'LOC-001',
    name: 'Centrála Praha',
    parentId: null,
    type: ref('HQ', 'Centrála'),
    address: 'Vinohradská 12, Praha',
    note: null,
    path: [ref('LOC-001', 'Centrála Praha')],
    itemCount: 38,
    childCount: 4,
    ...over,
  };
}

function item(over: Record<string, unknown> = {}) {
  const place = ref('LOC-019', 'Teplá kuchyně');
  return {
    ...record,
    id: crypto.randomUUID(),
    code: 'INV-00042',
    name: 'Konvektomat',
    model: 'SCC 101',
    serialNumber: null,
    manufacturer: { id: crypto.randomUUID(), name: 'Rational' },
    location: place,
    path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí'), place],
    warrantyUntil: null,
    lastServiceOn: null,
    nextServiceOn: null,
    ...over,
  };
}

const page = (items: unknown[], extra: { nextCursor?: string | null; total?: number } = {}) =>
  jsonResponse({ items, nextCursor: extra.nextCursor ?? null, total: extra.total ?? items.length });

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
    expect(await screen.findByRole('tab', { name: 'Lokality', selected: true })).toBeInTheDocument();
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

describe('home: items tab', () => {
  it('lists items with ID, full location path, brand and model, from the tab in the URL', async () => {
    api({ items: () => page([item()]) });
    renderApp('/?tab=items');

    expect(await screen.findByRole('tab', { name: 'Položky', selected: true })).toBeInTheDocument();
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Konvektomat');
    expect(row).toHaveTextContent('INV-00042');
    expect(row).toHaveTextContent('Centrála Praha › Přízemí › Teplá kuchyně');
    expect(row).toHaveTextContent('Rational SCC 101');
    expect(await screen.findByText('1 položka')).toBeInTheDocument();
  });

  it('shows a badge for overdue service and for service due within 30 days, none for later', async () => {
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    api({
      items: () =>
        page([
          item({ name: 'A', nextServiceOn: day(-1) }),
          item({ name: 'B', nextServiceOn: day(10) }),
          item({ name: 'C', nextServiceOn: day(90) }),
        ]),
    });
    renderApp('/?tab=items');
    const [a, b, c] = await screen.findAllByRole('listitem');
    expect(a).toHaveTextContent('Servis po termínu');
    expect(b).toHaveTextContent('Servis do 30 dní');
    expect(c).not.toHaveTextContent('Servis');
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
    await userEvent.click(await screen.findByRole('tab', { name: 'Položky' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'items' }));
    expect(await screen.findByRole('searchbox', { name: 'Hledat položky' })).toHaveValue('');
    await userEvent.click(screen.getByRole('tab', { name: 'Lokality' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('ignores an unknown tab in the URL', async () => {
    api({});
    renderApp('/?tab=users');
    expect(await screen.findByRole('tab', { name: 'Lokality', selected: true })).toBeInTheDocument();
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
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Server není dostupný.');
  }, 10_000);
});
