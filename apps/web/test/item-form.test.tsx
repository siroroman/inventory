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
    purchasePrice: 144902.5,
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
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.type(screen.getByPlaceholderText(/Hledat nebo zadat/), 'Winterhalter');
    await user.click(await screen.findByRole('button', { name: 'Vytvořit výrobce „Winterhalter“' }));
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
      purchasePrice: null,
      warrantyUntil: null,
      lastServiceOn: null,
      nextServiceOn: null,
      documentsUrl: null,
      note: null,
      externalIds: [{ source: 'Elektrikář', value: 'EL-1' }],
    });
    expect(await screen.findByText('Uloženo')).toBeInTheDocument();
  });

  it('keeps the location and manufacturer lists collapsed until a field is used', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/items/new');

    await screen.findByPlaceholderText(/Hledat lokalitu/);
    expect(screen.queryByRole('list', { name: /Výsledky/ })).not.toBeInTheDocument();
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
    expect(await screen.findByRole('list', { name: 'Výsledky: Lokalita' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Výsledky: Výrobce' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: /Výsledky/ })).not.toBeInTheDocument();
    await user.click(screen.getByPlaceholderText(/Hledat nebo zadat/));
    expect(await screen.findByRole('list', { name: 'Výsledky: Výrobce' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Výsledky: Lokalita' })).not.toBeInTheDocument();
  });

  it('searches locations together with their sub-locations, and lists the top level without a search', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/items/new');

    const params = () =>
      calls.filter((c) => new URL(c.url).pathname === '/api/v1/locations').map((c) => new URL(c.url).searchParams);
    await user.click(await screen.findByPlaceholderText(/Hledat lokalitu/));
    await waitFor(() => expect(params()).toHaveLength(1));
    expect(params()[0]?.has('withSubLocations')).toBe(false);
    await user.type(screen.getByPlaceholderText(/Hledat lokalitu/), 'centrala hradec');
    await waitFor(() => expect(params().at(-1)?.get('q')).toBe('centrala hradec'));
    expect(params().at(-1)?.get('withSubLocations')).toBe('true');
  });

  it('shows an empty external ID row to type in, and sends none when it stays empty', async () => {
    const created = detail({ id: crypto.randomUUID(), name: 'Myčka' });
    const calls = api({
      'POST /api/v1/items': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/items/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/items/new');

    expect(await screen.findByLabelText('Dodavatel externího ID 1')).toHaveValue('');
    expect(screen.getByLabelText('Externí ID 1')).toHaveValue('');
    await user.type(screen.getByLabelText('Název'), 'Myčka');
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await screen.findByRole('heading', { name: 'Myčka', level: 1 });
    expect(await bodyOf(calls, 'POST', '/api/v1/items')).toMatchObject({ externalIds: [] });
  });

  it('has just one Poznámka: the field label, no section title above it', async () => {
    api();
    renderApp('/items/new');
    await screen.findByLabelText('Poznámka');
    expect(screen.getAllByText('Poznámka')).toHaveLength(1);
  });

  it('sends the ID the user chose, and none when the field is left empty', async () => {
    const created = detail({ id: crypto.randomUUID(), name: 'Myčka' });
    const calls = api({
      'POST /api/v1/items': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/items/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/items/new');

    expect(await screen.findByText(/ID se přidělí automaticky/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('ID'), ' myc-1 ');
    await user.type(screen.getByLabelText('Název'), 'Myčka');
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await screen.findByRole('heading', { name: 'Myčka', level: 1 });
    expect(await bodyOf(calls, 'POST', '/api/v1/items')).toMatchObject({ code: 'myc-1' });
  });

  it('rejects an ID with characters a QR link cannot carry', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('ID'), 'špatné id');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText(/ID může mít nejvýše 30 znaků/)).toBeInTheDocument();
    expect(screen.getByLabelText('ID')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('says under the field that a chosen ID is taken', async () => {
    api({ 'POST /api/v1/items': () => problem(409, 'duplicate_item_code') });
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('ID'), 'MYC-1');
    await user.type(screen.getByLabelText('Název'), 'Myčka');
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Položka s tímto ID už existuje.')).toBeInTheDocument();
    expect(screen.getByLabelText('ID')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a clash of the automatic ID above the buttons, not under the empty field', async () => {
    api({ 'POST /api/v1/items': () => problem(409, 'duplicate_item_code') });
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Název'), 'Myčka');
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ID se nepodařilo přidělit automaticky');
    expect(screen.getByLabelText('ID')).not.toHaveAttribute('aria-invalid');
  });

  it('reports what is missing or wrong and sends nothing', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Rok výroby'), '1800');
    await user.type(screen.getByLabelText(/Složka dokumentů/), 'https://example.com/x');
    await user.type(screen.getByLabelText('Externí ID 1'), 'EL-1');
    await user.type(screen.getByLabelText('Pořizovací cena (Kč)'), '12,345');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Zadejte rok od 1950 do letošního roku.')).toBeInTheDocument();
    expect(screen.getByText(/Zadejte odkaz https/)).toBeInTheDocument();
    expect(screen.getByText(/Zadejte částku v korunách/)).toBeInTheDocument();
    // The name, and the source of the external ID that has only its value.
    expect(screen.getAllByText('Vyplňte toto pole.')).toHaveLength(2);
    expect(screen.getByLabelText('Název')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('saves an item without a location', async () => {
    const created = detail({ id: crypto.randomUUID(), name: 'Váha', location: null, path: [] });
    const calls = api({
      'POST /api/v1/items': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/items/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Název'), 'Váha');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { name: 'Váha', level: 1 })).toBeInTheDocument();
    expect(await bodyOf(calls, 'POST', '/api/v1/items')).toMatchObject({ name: 'Váha', locationId: null });
  });

  it('shows the API error above the buttons, e.g. an external ID that is taken', async () => {
    api({ 'POST /api/v1/items': () => problem(409, 'duplicate_external_id') });
    const user = userEvent.setup();
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Název'), 'Myčka');
    await user.click(screen.getByPlaceholderText(/Hledat lokalitu/));
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

  it('shows the price the Czech way and sends it as a number', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 3 })),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 4, purchasePrice: 39440 })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    const price = await screen.findByLabelText('Pořizovací cena (Kč)');
    expect((price as HTMLInputElement).value.replace(/\s/g, ' ')).toBe('144 902,5');
    await user.clear(price);
    await user.type(price, '39 440,00');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await waitFor(async () =>
      expect(await bodyOf(calls, 'PATCH', `/api/v1/items/${id}`)).toEqual({ purchasePrice: 39440, version: 3 }),
    );
  });

  it('shows the ID read-only and never sends it', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 2 })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    const code = await screen.findByLabelText('ID');
    expect(code).toHaveValue('INV-00042');
    expect(code).toBeDisabled();
    await user.type(screen.getByLabelText('Model'), 'x');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await waitFor(async () => expect(await bodyOf(calls, 'PATCH', `/api/v1/items/${id}`)).not.toHaveProperty('code'));
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

  it('clears the location with its clear button', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 2, location: null, path: [] })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    await user.click(await screen.findByRole('button', { name: 'Vymazat: Lokalita' }));
    expect(screen.getByPlaceholderText(/Hledat lokalitu/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await waitFor(async () =>
      expect(await bodyOf(calls, 'PATCH', `/api/v1/items/${id}`)).toEqual({ locationId: null, version: 1 }),
    );
  });

  it('opens an item that has no location', async () => {
    api({ [`GET /api/v1/items/${id}`]: () => jsonResponse(detail({ location: null, path: [] })) });
    renderApp(`/items/${id}/edit`);
    expect(await screen.findByPlaceholderText(/Hledat lokalitu/)).toBeInTheDocument();
    expect(screen.getByLabelText('Název')).toHaveValue('Konvektomat');
  });

  it('keeps the current location when the search is opened and left without choosing', async () => {
    api({ [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()) });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    await user.click(await screen.findByLabelText('Lokalita'));
    expect(await screen.findByRole('list', { name: 'Výsledky: Lokalita' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Lokalita')).toHaveTextContent('Centrála Praha › Přízemí › Teplá kuchyně');
    expect(screen.queryByRole('list', { name: 'Výsledky: Lokalita' })).not.toBeInTheDocument();
  });

  it('can change the location and clear the manufacturer', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 2 })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    // Tapping the field itself opens the search; there is no separate change button.
    expect(await screen.findByLabelText('Lokalita')).toHaveTextContent('Centrála Praha › Přízemí › Teplá kuchyně');
    expect(screen.queryByRole('button', { name: /Změnit/ })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Lokalita'));
    await user.click(await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' }));
    expect(screen.getByLabelText('Lokalita')).toHaveTextContent('Centrála Praha › Teplá kuchyně');
    await user.click(screen.getByRole('button', { name: 'Vymazat: Výrobce' }));
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

  it('does not open an archived item for editing', async () => {
    api({ [`GET /api/v1/items/${id}`]: () => jsonResponse(detail({ archivedAt: '2026-05-01T00:00:00.000Z' })) });
    renderApp(`/items/${id}/edit`);
    expect(await screen.findByText('Záznam je archivovaný.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('starts a second search from the whole list, not from text typed before leaving', async () => {
    api({ [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()) });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);

    await user.click(await screen.findByLabelText('Lokalita'));
    await user.type(screen.getByPlaceholderText('Centrála Praha › Přízemí › Teplá kuchyně'), 'kuch');
    await user.keyboard('{Escape}');
    await user.click(screen.getByLabelText('Lokalita'));
    expect(screen.getByPlaceholderText('Centrála Praha › Přízemí › Teplá kuchyně')).toHaveValue('');
  });

  it('saves an edit of an item whose old ID the rules would not accept today', async () => {
    const calls = api({
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail({ code: 'stará položka č.1' })),
      [`PATCH /api/v1/items/${id}`]: () => jsonResponse(detail({ version: 2, model: 'x' })),
    });
    const user = userEvent.setup();
    renderApp(`/items/${id}/edit`);
    expect(await screen.findByLabelText('ID')).toHaveValue('stará položka č.1');
    await user.type(screen.getByLabelText('Model'), 'x');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await waitFor(async () => expect(await bodyOf(calls, 'PATCH', `/api/v1/items/${id}`)).toMatchObject({ model: expect.stringContaining('x') }));
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

describe('new item from a location', () => {
  it('starts in that location and goes back to it on Zrušit', async () => {
    api({ [`GET /api/v1/locations/${kitchen.id}`]: () => jsonResponse(kitchen) });
    const user = userEvent.setup();
    const { router } = renderApp(`/items/new?locationId=${kitchen.id}`);

    expect(await screen.findByLabelText('Lokalita')).toHaveTextContent('Centrála Praha › Teplá kuchyně');
    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/locations/${kitchen.id}`));
  });

  it('leaves the location empty when it cannot be read', async () => {
    api({ [`GET /api/v1/locations/${kitchen.id}`]: () => problem(404, 'not_found') });
    renderApp(`/items/new?locationId=${kitchen.id}`);
    expect(await screen.findByPlaceholderText(/Hledat lokalitu/)).toBeInTheDocument();
  });
});

describe('shared cache', () => {
  it('does not break the location form, which searches locations too, after the item form was open', async () => {
    const hq = location({ name: 'Centrála Praha' });
    api({
      'GET /api/v1/location-types': () => jsonResponse({ items: [ref('HQ', 'Centrála')] }),
      [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse(hq),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/items/new');
    await user.click(await screen.findByPlaceholderText(/Hledat lokalitu/));
    await screen.findByRole('button', { name: 'Centrála Praha › Teplá kuchyně' });

    await router.navigate({ to: '/locations/new', search: { parentId: hq.id } });
    await user.click(await screen.findByRole('button', { name: 'Změnit' }));
    expect(await screen.findByRole('button', { name: /Teplá kuchyně/ })).toBeInTheDocument();
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
