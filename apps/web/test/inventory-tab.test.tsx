import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { inventoryEntry, page, person, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

const praha = ref('LOC-001', 'Centrála Praha');
const patro = ref('LOC-002', 'Patro 2');
const sklad = ref('LOC-004', 'Sklad');
const roman = person('Roman Siro');
const jan = person('Jan Novák');

const none = () => page([]);

/** Signed in, with the answers for the runs in progress and for the ended ones. */
function api(lists: { open?: (request: Request) => Response; closed?: (request: Request) => Response } = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    'GET /api/v1/inventories': (request) => {
      const state = new URL(request.url).searchParams.get('state');
      return (state === 'closed' ? (lists.closed ?? none) : (lists.open ?? none))(request);
    },
  });
}

const listCalls = (calls: Request[]) =>
  calls.filter((call) => new URL(call.url).pathname === '/api/v1/inventories').map((call) => new URL(call.url).searchParams);

const running = (over: Record<string, unknown> = {}) =>
  inventoryEntry({
    location: sklad,
    path: [praha, patro, sklad],
    startedBy: roman,
    participants: [roman, jan],
    counts: { expected: 128, checked: 84, elsewhere: 0, new: 0, missing: 0 },
    ...over,
  });

const ended = (over: Record<string, unknown> = {}) =>
  inventoryEntry({
    status: 'finished',
    location: praha,
    path: [praha],
    startedAt: '2026-10-03T07:15:00.000Z',
    endedAt: '2026-10-04T14:02:00.000Z',
    endedBy: jan,
    startedBy: roman,
    counts: { expected: 128, checked: 120, elsewhere: 3, new: 0, missing: 5 },
    ...over,
  });

describe('home: inventory tab', () => {
  it('is the fifth tab and is selected by the URL', async () => {
    api();
    renderApp('/?tab=inventory');
    expect(await screen.findByRole('tab', { name: 'Inventura', selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Lokality',
      'Položky',
      'Údržba',
      'Dodavatelé',
      'Inventura',
    ]);
  });

  it('shows the runs in progress as cards with the progress, the starter and the people', async () => {
    const run = running();
    api({ open: () => page([run], { total: 1 }) });
    renderApp('/?tab=inventory');

    expect(await screen.findByRole('heading', { name: 'Probíhající (1)', level: 2 })).toBeInTheDocument();
    const card = (await screen.findAllByRole('listitem'))[0]!;
    expect(card).toHaveTextContent('Sklad');
    expect(card).toHaveTextContent('Centrála Praha › Patro 2');
    expect(card).toHaveTextContent('84 / 128 zkontrolováno · 66 %');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '84');
    expect(card).toHaveTextContent(/Zahájil RS · 3\. 10\. 2026 v \d{1,2}:\d{2}/);
    expect(within(card).getByText('Roman Siro, Jan Novák')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Pokračovat' })).toHaveAttribute('href', `/inventories/${run.id}`);
  });

  it('lets a reader only view a run, and not start one', async () => {
    api({ open: () => page([running()]) }, 'read');
    renderApp('/?tab=inventory');
    const card = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(card).getByRole('link', { name: 'Zobrazit' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Zahájit inventuru/ })).not.toBeInTheDocument();
  });

  it('lists the ended runs with their date, result and state, the cancelled one with who started it', async () => {
    const done = ended();
    const gone = ended({
      status: 'cancelled',
      location: sklad,
      path: [praha, sklad],
      endedAt: '2026-10-05T09:00:00.000Z',
      counts: { expected: 10, checked: 4, elsewhere: 0, new: 0, missing: 0 },
    });
    api({ closed: () => page([gone, done], { total: 2 }) });
    renderApp('/?tab=inventory');

    expect(await screen.findByRole('heading', { name: 'Dokončené (2)', level: 2 })).toBeInTheDocument();
    const [cancelled, finished] = await screen.findAllByRole('listitem');
    expect(cancelled).toHaveTextContent('Sklad');
    expect(cancelled).toHaveTextContent('Zrušená');
    expect(cancelled).toHaveTextContent('5. 10. 2026 · zahájil RS');
    expect(cancelled).toHaveTextContent('4 z 10 zkontrolováno');
    expect(within(cancelled!).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/inventories\//));
    expect(finished).toHaveTextContent('Dokončená');
    expect(finished).toHaveTextContent('120 nalezeno · 3 jinde · 5 nezvěstných');
  });

  it('shows a table of the ended runs on a wide screen', async () => {
    stubWideScreen(true);
    const done = ended();
    api({ closed: () => page([done, ended({ counts: { expected: 5, checked: 5, elsewhere: 0, new: 0, missing: 1 } })], { total: 2 }) });
    renderApp('/?tab=inventory');

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Lokalita', 'Datum', 'Výsledek', 'Stav']);
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'Centrála Praha',
      '4. 10. 2026',
      '120 nalezeno · 3 jinde · 5 nezvěstných',
      'Dokončená',
    ]);
    expect(within(rows[2]!).getByText('5 nalezeno · 1 nezvěstná')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: 'Centrála Praha' })).toHaveAttribute('href', `/inventories/${done.id}`);
  });

  it('keeps the runs in progress as cards on a wide screen', async () => {
    stubWideScreen(true);
    api({ open: () => page([running()]) });
    renderApp('/?tab=inventory');
    expect(await screen.findByRole('link', { name: 'Pokračovat' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  describe('starting a run', () => {
    it('is the bar at the bottom on a phone', async () => {
      api({ open: () => page([running()]) });
      renderApp('/?tab=inventory');
      const start = await screen.findByRole('link', { name: 'Zahájit inventuru' });
      expect(start).toHaveAttribute('href', '/inventories/new');
      expect(start.closest('div')).toHaveClass('sticky', 'bottom-0');
    });

    it('is beside the heading and the search on a desktop', async () => {
      stubWideScreen(true);
      api({ open: () => page([running()]) });
      renderApp('/?tab=inventory');
      const start = await screen.findByRole('link', { name: 'Zahájit inventuru' });
      expect(start).toHaveAttribute('href', '/inventories/new');
      expect(start.closest('.sticky')).toBeNull();
      expect(screen.getByRole('searchbox', { name: 'Hledat inventury' })).toBeInTheDocument();
    });

    it('is offered in the welcome when there is no inventory at all, once', async () => {
      api();
      renderApp('/?tab=inventory');
      expect(await screen.findByText('Zatím žádná inventura')).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'Zahájit inventuru' })).toHaveLength(2);
      expect(screen.queryByText('Žádná inventura neprobíhá')).not.toBeInTheDocument();
    });

    it('is not offered to a reader', async () => {
      api({}, 'read');
      renderApp('/?tab=inventory');
      expect(await screen.findByText('Zatím žádná inventura')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Zahájit inventuru' })).not.toBeInTheDocument();
    });
  });

  it('says what is missing when only one of the two lists is empty', async () => {
    api({ closed: () => page([ended()]) });
    renderApp('/?tab=inventory');
    expect(await screen.findByText('Žádná inventura neprobíhá')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Probíhající (0)' })).toBeInTheDocument();
    expect(screen.queryByText('Zatím žádná inventura')).not.toBeInTheDocument();
  });

  it('says there is no ended run yet', async () => {
    api({ open: () => page([running()]) });
    renderApp('/?tab=inventory');
    expect(await screen.findByText('Zatím žádná dokončená inventura')).toBeInTheDocument();
  });

  it('searches 300 ms after typing stops, in both lists, and keeps the text in the URL', async () => {
    const calls = api();
    const { router } = renderApp('/?tab=inventory');
    await screen.findByText('Zatím žádná inventura');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Hledat inventury' }), 'praha');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'inventory', q: 'praha' }));
    await screen.findByText('Nic jsme nenašli');
    const searched = listCalls(calls).filter((params) => params.get('q') === 'praha');
    expect(searched.map((params) => params.get('state')).sort()).toEqual(['closed', 'open']);
    expect(searched.every((params) => params.get('limit') === '20')).toBe(true);
  });

  it('loads the next page of the ended runs with the cursor', async () => {
    const calls = api({
      closed: (request) =>
        new URL(request.url).searchParams.get('cursor')
          ? page([ended({ location: ref('LOC-009', 'Zeta') })], { total: 2 })
          : page([ended({ location: ref('LOC-008', 'Alfa') })], { nextCursor: 'abc', total: 2 }),
    });
    renderApp('/?tab=inventory');
    await userEvent.click(await screen.findByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Zeta')).toBeInTheDocument();
    expect(screen.getByText('Alfa')).toBeInTheDocument();
    const closedCalls = listCalls(calls).filter((params) => params.get('state') === 'closed');
    expect(closedCalls.at(-1)?.get('cursor')).toBe('abc');
  });

  it('refreshes when the tab is opened again, not from an old copy', async () => {
    let count = 0;
    const calls = api({ open: () => page([running({ counts: { expected: 10, checked: ++count, elsewhere: 0, new: 0, missing: 0 } })]) });
    const { router } = renderApp('/?tab=inventory');
    expect(await screen.findByText('1 / 10 zkontrolováno · 10 %')).toBeInTheDocument();

    await router.navigate({ to: '/', search: { tab: 'items' } });
    await router.navigate({ to: '/', search: { tab: 'inventory' } });
    expect(await screen.findByText('2 / 10 zkontrolováno · 20 %')).toBeInTheDocument();
    expect(listCalls(calls).filter((params) => params.get('state') === 'open').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error with a retry when a list fails', async () => {
    let fail = true;
    api({
      open: () =>
        fail
          ? jsonResponse({ type: 'about:blank', title: 'x', status: 500, code: 'internal_error' }, { status: 500, problem: true })
          : page([running()]),
    });
    renderApp('/?tab=inventory');
    const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('link', { name: 'Pokračovat' })).toBeInTheDocument();
  });

  it('switches to the tab from another one and drops the search', async () => {
    api();
    const { router } = renderApp('/?tab=items&q=abc');
    await userEvent.click(await screen.findByRole('tab', { name: 'Inventura' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'inventory' }));
  });
});
