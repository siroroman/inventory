import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { page, recordListEntry } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

function api(list: (request: Request) => Response = () => page([])) {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse(me),
    'GET /api/v1/service-records': list,
  });
}

const listCalls = (calls: Request[]) =>
  calls.filter((call) => new URL(call.url).pathname === '/api/v1/service-records').map((call) => new URL(call.url).searchParams);

describe('home: maintenance tab', () => {
  it('lists records with the date, item and location path under a heading with the total', async () => {
    api(() => page([recordListEntry()], { total: 3 }));
    renderApp('/?tab=maintenance');

    expect(await screen.findByRole('tab', { name: 'Údržba', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('3 záznamy')).toBeInTheDocument();
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Výměna filtru a kontrola tlaku');
    expect(row).toHaveTextContent('15. 4. 2026 · Kávovar Linea PB');
    expect(row).toHaveTextContent('Centrála Praha › Přízemí výroba › Teplá kuchyně');
    expect(within(row).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/service-records\//));
  });

  it('shows a table with the item as a link on a wide screen', async () => {
    stubWideScreen(true);
    const entry = recordListEntry();
    api(() => page([entry]));
    renderApp('/?tab=maintenance');

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Název',
      'Datum',
      'Položka',
      'Lokalita',
    ]);
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual([
      'Výměna filtru a kontrola tlaku',
      '15. 4. 2026',
      'Kávovar Linea PB',
      'Centrála Praha › Přízemí výroba › Teplá kuchyně',
    ]);
    expect(screen.getByRole('link', { name: 'Kávovar Linea PB' })).toHaveAttribute('href', `/items/${(entry.item as { id: string }).id}`);
  });

  it('copes with an item that has no location yet', async () => {
    api(() => page([recordListEntry({ location: null, path: [] })]));
    renderApp('/?tab=maintenance');
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('15. 4. 2026 · Kávovar Linea PB');
    expect(row).not.toHaveTextContent('›');
  });

  it('says there is nothing yet when the list is empty', async () => {
    api();
    renderApp('/?tab=maintenance');
    expect(await screen.findByText('Zatím žádný servisní záznam')).toBeInTheDocument();
    expect(screen.queryByText('Nic jsme nenašli')).not.toBeInTheDocument();
  });

  it('says nothing was found when a search has no match', async () => {
    api();
    renderApp('/?tab=maintenance&q=nic');
    expect(await screen.findByText('Nic jsme nenašli')).toBeInTheDocument();
  });

  it('searches 300 ms after typing stops and keeps the text in the URL', async () => {
    const calls = api();
    const { router } = renderApp('/?tab=maintenance');
    await screen.findByText('Zatím žádný servisní záznam');

    const box = screen.getByRole('searchbox', { name: 'Hledat servisní záznamy' });
    expect(box).toHaveAttribute('placeholder', 'Hledat podle názvu, položky, lokality…');
    await userEvent.type(box, 'filtr');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'maintenance', q: 'filtr' }));
    await screen.findByText('Nic jsme nenašli');
    expect(listCalls(calls).map((params) => params.get('q'))).toEqual([null, 'filtr']);
    expect(listCalls(calls).every((params) => params.get('limit') === '20')).toBe(true);
  });

  it('loads the next page with the cursor', async () => {
    const calls = api((request) =>
      new URL(request.url).searchParams.get('cursor')
        ? page([recordListEntry({ title: 'Starší záznam' })], { total: 2 })
        : page([recordListEntry({ title: 'Novější záznam' })], { nextCursor: 'abc', total: 2 }),
    );
    renderApp('/?tab=maintenance');
    await userEvent.click(await screen.findByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Starší záznam')).toBeInTheDocument();
    expect(screen.getByText('Novější záznam')).toBeInTheDocument();
    expect(listCalls(calls).at(-1)?.get('cursor')).toBe('abc');
  });

  it('lists the archived records, marked, once "Zobrazit archivované" is ticked, and goes back when cleared', async () => {
    const calls = api((request) =>
      new URL(request.url).searchParams.get('archived') === 'true'
        ? page([recordListEntry({ title: 'Starý záznam', archivedAt: '2026-05-01T00:00:00.000Z' })])
        : page([recordListEntry({ title: 'Platný záznam' })]),
    );
    const { router } = renderApp('/?tab=maintenance');
    expect(await screen.findByText('Platný záznam')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zobrazit archivované' }));
    expect(await screen.findByText('Starý záznam')).toBeInTheDocument();
    expect(screen.getByText('Archivováno')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'maintenance', archived: true });
    expect(listCalls(calls).at(-1)?.get('archived')).toBe('true');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zobrazit archivované' }));
    expect(await screen.findByText('Platný záznam')).toBeInTheDocument();
    expect(screen.queryByText('Archivováno')).not.toBeInTheDocument();
  });

  it('says so when no record is archived', async () => {
    api();
    renderApp('/?tab=maintenance&archived=true');
    expect(await screen.findByText('Žádné archivované záznamy')).toBeInTheDocument();
  });

  it('switches to the tab and drops the search of the other one', async () => {
    api();
    const { router } = renderApp('/?tab=items&q=abc');
    await userEvent.click(await screen.findByRole('tab', { name: 'Údržba' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'maintenance' }));
  });
});
