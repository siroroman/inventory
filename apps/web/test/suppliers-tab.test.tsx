import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { page, provider } from './fixtures.ts';
import { jsonResponse, me, openSection, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

function api(list: (request: Request) => Response = () => page([]), role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    'GET /api/v1/service-providers': list,
  });
}

const listCalls = (calls: Request[]) =>
  calls.filter((call) => new URL(call.url).pathname === '/api/v1/service-providers').map((call) => new URL(call.url).searchParams);

describe('home: suppliers tab', () => {
  it('lists the suppliers with ID, phone and brands under a heading with the total', async () => {
    const novak = provider({
      manufacturers: [
        { id: crypto.randomUUID(), name: 'Daikin', archivedAt: null, priority: 1 },
        { id: crypto.randomUUID(), name: 'La Marzocco', archivedAt: null, priority: 2 },
      ],
    });
    api(() => page([novak], { total: 3 }));
    renderApp('/?tab=suppliers');

    expect(await screen.findByRole('heading', { name: 'Dodavatelé', level: 2 })).toBeInTheDocument();
    expect(await screen.findByText('3 dodavatelé')).toBeInTheDocument();
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Servis Novák s.r.o.');
    expect(row).toHaveTextContent('SUP-001 · +420 601 123 456');
    expect(row).toHaveTextContent('Daikin, La Marzocco');
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/service-providers/${novak.id}`);
  });

  it('shows a table with the name as a link on a wide screen', async () => {
    stubWideScreen(true);
    const novak = provider();
    const marzocco = { id: crypto.randomUUID(), name: 'La Marzocco', archivedAt: null, priority: 1 };
    const daikin = { id: crypto.randomUUID(), name: 'Daikin', archivedAt: null, priority: 2 };
    api(() =>
      page([
        provider({ ...novak, manufacturers: [daikin, marzocco] }),
        provider({ code: 'SUP-002', name: 'AquaTech servis', phone: null }),
      ]),
    );
    renderApp('/?tab=suppliers');

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Název', 'ID', 'Telefon', 'Výrobci']);
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Servis Novák s.r.o.', 'SUP-001', '+420 601 123 456', 'Daikin, La Marzocco']);
    expect(within(rows[2]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['AquaTech servis', 'SUP-002', '—', '—']);
    expect(screen.getByRole('link', { name: 'Servis Novák s.r.o.' })).toHaveAttribute('href', `/service-providers/${novak.id}`);
  });

  it('says there is nothing yet when the list is empty', async () => {
    api();
    renderApp('/?tab=suppliers');
    expect(await screen.findByText('Zatím žádný dodavatel')).toBeInTheDocument();
    expect(screen.queryByText('Nic jsme nenašli')).not.toBeInTheDocument();
  });

  it('says nothing was found when a search has no match', async () => {
    api();
    renderApp('/?tab=suppliers&q=nic');
    expect(await screen.findByText('Nic jsme nenašli')).toBeInTheDocument();
  });

  it('searches 300 ms after typing stops and keeps the text in the URL', async () => {
    const calls = api();
    const { router } = renderApp('/?tab=suppliers');
    await screen.findByText('Zatím žádný dodavatel');

    const box = screen.getByRole('searchbox', { name: 'Hledat dodavatele' });
    expect(box).toHaveAttribute('placeholder', 'Hledat podle názvu, ID, telefonu, výrobce…');
    await userEvent.type(box, 'novak');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'suppliers', q: 'novak' }));
    await screen.findByText('Nic jsme nenašli');
    expect(listCalls(calls).map((params) => params.get('q'))).toEqual([null, 'novak']);
    expect(listCalls(calls).every((params) => params.get('limit') === '20')).toBe(true);
  });

  it('loads the next page with the cursor', async () => {
    const calls = api((request) =>
      new URL(request.url).searchParams.get('cursor')
        ? page([provider({ name: 'Zeta servis' })], { total: 2 })
        : page([provider({ name: 'Alfa servis' })], { nextCursor: 'abc', total: 2 }),
    );
    renderApp('/?tab=suppliers');
    await userEvent.click(await screen.findByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Zeta servis')).toBeInTheDocument();
    expect(screen.getByText('Alfa servis')).toBeInTheDocument();
    expect(listCalls(calls).at(-1)?.get('cursor')).toBe('abc');
  });

  it('lists the archived suppliers, marked, once "Zobrazit archivované" is ticked, and goes back when cleared', async () => {
    const calls = api((request) =>
      new URL(request.url).searchParams.get('archived') === 'true'
        ? page([provider({ name: 'Starý servis', archivedAt: '2026-05-01T00:00:00.000Z' })])
        : page([provider({ name: 'Platný servis' })]),
    );
    const { router } = renderApp('/?tab=suppliers');
    expect(await screen.findByText('Platný servis')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zobrazit archivované' }));
    expect(await screen.findByText('Starý servis')).toBeInTheDocument();
    expect(screen.getByText('Archivováno')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'suppliers', archived: true });
    expect(listCalls(calls).at(-1)?.get('archived')).toBe('true');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zobrazit archivované' }));
    expect(await screen.findByText('Platný servis')).toBeInTheDocument();
    expect(screen.queryByText('Archivováno')).not.toBeInTheDocument();
  });

  it('says so when no supplier is archived', async () => {
    api();
    renderApp('/?tab=suppliers&archived=true');
    expect(await screen.findByText('Žádní archivovaní dodavatelé')).toBeInTheDocument();
  });

  it('switches to the tab and drops the search of the other one', async () => {
    api();
    const { router } = renderApp('/?tab=items&q=abc');
    await openSection('Dodavatelé');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'suppliers' }));
  });
});
