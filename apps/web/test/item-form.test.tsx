import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { item, location, page, record, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const id = '5b1c6d2e-3f4a-4b5c-8d9e-0a1b2c3d4e5f';
const kitchen = location({
  name: 'Teplá kuchyně',
  type: null,
  path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-019', 'Teplá kuchyně')],
});

function detail(over: Record<string, unknown> = {}) {
  return {
    ...item({ id }),
    manufactureYear: 2018,
    registeredOn: '2019-05-01',
    documentsUrl: null,
    note: null,
    externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
    photos: [],
    ...over,
  };
}

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

/** Signed in as `role`, with the lookups the form needs and whatever the test adds. */
function api(routes: Parameters<typeof stubApi>[0] = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    'GET /api/v1/locations': () => page([kitchen]),
    'GET /api/v1/manufacturers': () => page([]),
    'GET /api/v1/items': () => page([]),
    ...routes,
  });
}

const bodyOf = (calls: Request[], method: string, path: string) =>
  calls
    .filter((c) => c.method === method && new URL(c.url).pathname === path)
    .at(-1)
    ?.clone()
    .json();

afterEach(() => vi.restoreAllMocks());

describe('new item', () => {
  it('creates an item with a picked location, a new manufacturer and an external ID', async () => {
    const created = detail({ id: crypto.randomUUID(), name: 'Myčka' });
    const manufacturerId = 'b0000000-0000-4000-8000-000000000001';
    const calls = api({
      'POST /api/v1/manufacturers': () =>
        jsonResponse({ ...record, id: manufacturerId, name: 'Winterhalter', note: null }, { status: 201 }),
      'POST /api/v1/items': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/items/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/items/new');

    expect(await screen.findByRole('heading', { name: 'Nová položka', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Název'), '  Myčka ');
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.type(screen.getByPlaceholderText(/Hledat nebo zadat/), 'Winterhalter');
    await user.click(await screen.findByRole('button', { name: 'Vytvořit výrobce „Winterhalter“' }));
    await user.click(screen.getByRole('button', { name: 'Přidat externí ID' }));
    await user.type(screen.getByLabelText('Dodavatel externího ID 1'), 'Elektrikář');
    await user.type(screen.getByLabelText('Externí ID 1'), 'EL-1');
    await user.type(screen.getByLabelText('Rok výroby'), '2020');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { name: 'Myčka', level: 1 })).toBeInTheDocument();
    expect(await bodyOf(calls, 'POST', '/api/v1/items')).toEqual({
      name: 'Myčka',
      locationId: kitchen.id,
      manufacturerId,
      model: null,
      serialNumber: null,
      manufactureYear: 2020,
      registeredOn: null,
      warrantyUntil: null,
      lastServiceOn: null,
      nextServiceOn: null,
      documentsUrl: null,
      note: null,
      externalIds: [{ source: 'Elektrikář', value: 'EL-1' }],
    });
    expect(await screen.findByText('Uloženo')).toBeInTheDocument();
  });

  it('reports what is missing or wrong and sends nothing', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Rok výroby'), '1800');
    await user.type(screen.getByLabelText(/Složka dokumentů/), 'https://example.com/x');
    await user.click(screen.getByRole('button', { name: 'Přidat externí ID' }));
    await user.type(screen.getByLabelText('Externí ID 1'), 'EL-1');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Vyberte lokalitu.')).toBeInTheDocument();
    expect(screen.getByText('Zadejte rok od 1950 do letošního roku.')).toBeInTheDocument();
    expect(screen.getByText(/Zadejte odkaz https/)).toBeInTheDocument();
    // The name, and the source of the external ID that has only its value.
    expect(screen.getAllByText('Vyplňte toto pole.')).toHaveLength(2);
    expect(screen.getByLabelText('Název')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the API error above the buttons, e.g. an external ID that is taken', async () => {
    api({ 'POST /api/v1/items': () => problem(409, 'duplicate_external_id') });
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Název'), 'Myčka');
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Toto externí ID už je u jiné položky použité.');
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
  });

  it('asks in the page before leaving with unsaved changes', async () => {
    api();
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Název'), 'Myčka');
    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Zahodit neuložené změny?' });
    await user.click(within(dialog).getByRole('button', { name: 'Zůstat na stránce' }));
    expect(screen.getByLabelText('Název')).toHaveValue('Myčka');

    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Opustit stránku' }));
    expect(await screen.findByRole('tab', { name: 'Položky', selected: true })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves without asking when nothing was typed', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/items/new');
    await user.click(await screen.findByRole('link', { name: 'Zrušit' }));
    expect(await screen.findByRole('tab', { name: 'Položky', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not let a reader in', async () => {
    api({}, 'read');
    renderApp('/items/new');
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });
});

describe('edit item', () => {
  it('fills in the item and sends only what changed with the version', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 3 })),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 4, model: 'SCC 202' })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    expect(await screen.findByRole('heading', { name: 'Upravit položku', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Název')).toHaveValue('Konvektomat');
    expect(screen.getByText('Centrála Praha › Přízemí › Teplá kuchyně')).toBeInTheDocument();
    expect(screen.getByText('Rational')).toBeInTheDocument();
    expect(screen.getByLabelText('Externí ID 1')).toHaveValue('EL-4821');
    expect(screen.getByLabelText('Rok výroby')).toHaveValue('2018');
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Model'));
    await user.type(screen.getByLabelText('Model'), 'SCC 202');
    await user.clear(screen.getByLabelText('Rok výroby'));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await waitFor(async () =>
      expect(await bodyOf(calls, 'PATCH', `/api/v1/items/${id}`)).toEqual({
        model: 'SCC 202',
        manufactureYear: null,
        version: 3,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
  });

  it('sends nothing when the only change is a trailing space', async () => {
    const calls = api({ [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()) });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    await user.type(await screen.findByLabelText('Název'), ' ');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('can change the location and clear the manufacturer', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 2 })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    await user.click(await screen.findByRole('button', { name: 'Změnit: Lokalita' }));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.click(screen.getByRole('button', { name: 'Změnit: Výrobce' }));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await waitFor(async () =>
      expect(await bodyOf(calls, 'PATCH', `/api/v1/items/${id}`)).toEqual({
        locationId: kitchen.id,
        manufacturerId: null,
        version: 1,
      }),
    );
  });

  it('says so on a conflict and reloads the current data on request', async () => {
    let version = 1;
    const calls = api({
      [`GET /api/v1/items/${id}`]: () =>
        jsonResponse(detail({ version, name: version === 1 ? 'Konvektomat' : 'Konvektomat 2' })),
      [`PATCH /api/v1/items/${id}`]: () => problem(409, 'conflict'),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    await user.type(await screen.findByLabelText('Model'), '2');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Záznam mezitím někdo upravil.');

    version = 2;
    await user.click(screen.getByRole('button', { name: 'Načíst aktuální data' }));
    await waitFor(() => expect(screen.getByLabelText('Název')).toHaveValue('Konvektomat 2'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'GET' && c.url.endsWith(`/items/${id}`)).length).toBeGreaterThan(1);
  });

  it('shows the not-found page for an item that does not exist', async () => {
    api({ [`GET /api/v1/items/${id}`]: () => problem(404, 'not_found') });
    renderApp(`/items/${id}/edit`);
    expect(await screen.findByText('Položka nenalezena')).toBeInTheDocument();
  });

  it('does not let a reader in', async () => {
    api({ [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()) }, 'read');
    renderApp(`/items/${id}/edit`);
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
  });
});

describe('entry points', () => {
  const withItem = { [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()) };

  it('offers Add item on the Items tab to writers', async () => {
    api();
    renderApp('/?tab=items');
    expect(await screen.findByRole('link', { name: 'Přidat položku' })).toHaveAttribute('href', '/items/new');
  });

  it('offers Edit on the detail to writers', async () => {
    api(withItem);
    renderApp(`/items/${id}`);
    expect(await screen.findByRole('link', { name: 'Upravit' })).toHaveAttribute('href', `/items/${id}/edit`);
  });

  it('hides Add item from readers', async () => {
    api({}, 'read');
    renderApp('/?tab=items');
    await screen.findByRole('heading', { name: 'Položky' });
    expect(screen.queryByRole('link', { name: 'Přidat položku' })).not.toBeInTheDocument();
  });

  it('hides Edit from readers', async () => {
    api(withItem, 'read');
    renderApp(`/items/${id}`);
    await screen.findByRole('heading', { name: 'Konvektomat', level: 1 });
    expect(screen.queryByRole('link', { name: 'Upravit' })).not.toBeInTheDocument();
  });
});
