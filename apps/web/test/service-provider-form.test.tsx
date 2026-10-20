import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { page, providerDetail, record } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const id = '3c8e1f52-7a4b-4d69-8e0a-9b1c2d3e4f50';
const marzoccoId = 'b0000000-0000-4000-8000-000000000001';
const daikinId = 'b0000000-0000-4000-8000-000000000002';
const brand = (brandId: string, name: string) => ({ ...record, id: brandId, name, note: null });

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

/** Signed in as `role`, with the brand search and whatever the test adds. */
function api(routes: Parameters<typeof stubApi>[0] = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    'GET /api/v1/manufacturers': () => page([brand(marzoccoId, 'La Marzocco'), brand(daikinId, 'Daikin')]),
    'GET /api/v1/service-providers': () => page([]),
    ...routes,
  });
}

const bodyOf = (calls: Request[], method: string, path: string) =>
  calls
    .filter((c) => c.method === method && new URL(c.url).pathname === path)
    .at(-1)
    ?.clone()
    .json();

describe('new supplier', () => {
  it('creates a supplier with its contact data and brands in one request, then opens its detail', async () => {
    const created = providerDetail({ id: crypto.randomUUID(), name: 'Servis Novák s.r.o.' });
    const calls = api({
      'POST /api/v1/service-providers': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/service-providers/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    expect(await screen.findByRole('heading', { name: 'Nový dodavatel', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Název'), '  Servis Novák s.r.o. ');
    await user.type(screen.getByLabelText('Kontaktní osoba'), 'Jan Novák');
    await user.type(screen.getByLabelText('Telefon'), '+420 601 123 456');
    await user.type(screen.getByLabelText('E-mail'), 'servis@novak-sro.cz');
    await user.type(screen.getByLabelText('Web'), 'www.novak-servis.cz');
    await user.click(screen.getByPlaceholderText('Přidat výrobce…'));
    await user.click(await screen.findByRole('button', { name: 'La Marzocco' }));
    await user.click(screen.getByPlaceholderText('Přidat výrobce…'));
    await user.click(await screen.findByRole('button', { name: 'Daikin' }));
    await user.type(screen.getByLabelText('Poznámka'), 'Do 24 hodin');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { name: 'Servis Novák s.r.o.', level: 1 })).toBeInTheDocument();
    expect(await bodyOf(calls, 'POST', '/api/v1/service-providers')).toEqual({
      name: 'Servis Novák s.r.o.',
      contactPerson: 'Jan Novák',
      phone: '+420 601 123 456',
      email: 'servis@novak-sro.cz',
      web: 'https://www.novak-servis.cz',
      note: 'Do 24 hodin',
      manufacturerIds: [marzoccoId, daikinId],
    });
    expect(await screen.findByText('Uloženo')).toBeInTheDocument();
  });

  it('needs only a name and sends the rest empty', async () => {
    const created = providerDetail({ id: crypto.randomUUID(), name: 'Jen název', manufacturers: [] });
    const calls = api({
      'POST /api/v1/service-providers': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/service-providers/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.type(await screen.findByLabelText('Název'), 'Jen název');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('heading', { name: 'Jen název', level: 1 });
    expect(await bodyOf(calls, 'POST', '/api/v1/service-providers')).toEqual({
      name: 'Jen název',
      contactPerson: null,
      phone: null,
      email: null,
      web: null,
      note: null,
      manufacturerIds: [],
    });
  });

  it('reports what is missing or wrong and sends nothing', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.click(await screen.findByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText('Vyplňte toto pole.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Název'), 'Servis');
    await user.type(screen.getByLabelText('E-mail'), 'servis@novak');
    await user.type(screen.getByLabelText('Web'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Zadejte platný e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Zadejte platnou webovou adresu.')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('takes a web address with a port but no scheme as https', async () => {
    const created = providerDetail({ id: crypto.randomUUID(), name: 'Servis' });
    const calls = api({
      'POST /api/v1/service-providers': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/service-providers/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.type(await screen.findByLabelText('Název'), 'Servis');
    await user.type(screen.getByLabelText('Web'), 'novak-servis.cz:8443/servis');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('heading', { name: 'Servis', level: 1 });
    expect(await bodyOf(calls, 'POST', '/api/v1/service-providers')).toMatchObject({ web: 'https://novak-servis.cz:8443/servis' });
  });

  it('adds a brand once, offers only the others, and removes a chosen one', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.click(await screen.findByPlaceholderText('Přidat výrobce…'));
    await user.click(await screen.findByRole('button', { name: 'La Marzocco' }));
    const chosen = screen.getByRole('list', { name: 'Servisovaní výrobci' });
    expect(within(chosen).getByText('La Marzocco')).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText('Přidat výrobce…'));
    const results = await screen.findByRole('list', { name: /Výsledky/ });
    expect(within(results).getAllByRole('button').map((b) => b.textContent)).toEqual(['Daikin']);

    await user.click(screen.getByRole('button', { name: 'Odebrat výrobce La Marzocco' }));
    expect(screen.queryByRole('list', { name: 'Servisovaní výrobci' })).not.toBeInTheDocument();
  });

  it('does not offer to create a brand that is already chosen, and asks for more to fill the page', async () => {
    const calls = api({
      'GET /api/v1/manufacturers': (request) => {
        const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
        return page([brand(marzoccoId, 'La Marzocco'), brand(daikinId, 'Daikin')].filter((b) => b.name.toLowerCase().includes(q)));
      },
    });
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.click(await screen.findByPlaceholderText('Přidat výrobce…'));
    await user.click(await screen.findByRole('button', { name: 'Daikin' }));
    await user.type(screen.getByPlaceholderText('Přidat výrobce…'), 'daikin');
    await waitFor(() =>
      expect(calls.some((c) => new URL(c.url).searchParams.get('q') === 'daikin')).toBe(true),
    );
    expect(await screen.findByText('Zatím žádný výrobce. Napište název a vytvořte ho.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vytvořit výrobce/ })).not.toBeInTheDocument();
    const last = calls.filter((c) => new URL(c.url).pathname === '/api/v1/manufacturers').at(-1)!;
    expect(new URL(last.url).searchParams.get('limit')).toBe('21');
  });

  it('creates a brand that does not exist yet and adds it', async () => {
    const created = providerDetail({ id: crypto.randomUUID(), name: 'Servis' });
    const calls = api({
      'GET /api/v1/manufacturers': () => page([]),
      'POST /api/v1/manufacturers': () => jsonResponse(brand(marzoccoId, 'Winterhalter'), { status: 201 }),
      'POST /api/v1/service-providers': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/service-providers/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.type(await screen.findByLabelText('Název'), 'Servis');
    await user.type(screen.getByPlaceholderText('Přidat výrobce…'), 'Winterhalter');
    await user.click(await screen.findByRole('button', { name: 'Vytvořit výrobce „Winterhalter“' }));
    expect(within(screen.getByRole('list', { name: 'Servisovaní výrobci' })).getByText('Winterhalter')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('heading', { name: 'Servis', level: 1 });
    expect(await bodyOf(calls, 'POST', '/api/v1/service-providers')).toMatchObject({ manufacturerIds: [marzoccoId] });
  });

  it('shows the API error above the buttons', async () => {
    api({ 'POST /api/v1/service-providers': () => problem(422, 'manufacturer_archived') });
    const user = userEvent.setup();
    renderApp('/service-providers/new');
    await user.type(await screen.findByLabelText('Název'), 'Servis');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
  });

  it('asks in the page before leaving with unsaved changes, and not when nothing was typed', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/service-providers/new');

    await user.type(await screen.findByLabelText('Název'), 'Servis');
    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Zahodit neuložené změny?' });
    await user.click(within(dialog).getByRole('button', { name: 'Zůstat na stránce' }));
    expect(screen.getByLabelText('Název')).toHaveValue('Servis');

    await user.clear(screen.getByLabelText('Název'));
    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    expect(await screen.findByRole('heading', { name: 'Dodavatelé', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not let a reader in', async () => {
    api({}, 'read');
    renderApp('/service-providers/new');
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });
});

describe('edit supplier', () => {
  const current = (over: Record<string, unknown> = {}) =>
    providerDetail({
      id,
      version: 3,
      manufacturers: [
        { id: marzoccoId, name: 'La Marzocco', archivedAt: null, priority: 1 },
        { id: daikinId, name: 'Daikin', archivedAt: null, priority: 2 },
      ],
      ...over,
    });

  it('fills in the supplier and sends only what changed with the version', async () => {
    const calls = api({
      [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(current()),
      [`PATCH /api/v1/service-providers/${id}`]: () => jsonResponse(current({ version: 4, phone: '+420 777 000 111' })),
    });
    const user = userEvent.setup();
    renderApp(`/service-providers/${id}/edit`);

    expect(await screen.findByRole('heading', { name: 'Upravit dodavatele', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Název')).toHaveValue('Servis Novák s.r.o.');
    expect(screen.getByLabelText('Web')).toHaveValue('https://www.novak-servis.cz');
    expect(within(screen.getByRole('list', { name: 'Servisovaní výrobci' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Telefon'));
    await user.type(screen.getByLabelText('Telefon'), '+420 777 000 111');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { name: 'Servis Novák s.r.o.', level: 1 })).toBeInTheDocument();
    expect(await bodyOf(calls, 'PATCH', `/api/v1/service-providers/${id}`)).toEqual({ phone: '+420 777 000 111', version: 3 });
  });

  it('sends the brands only when the set changed, and clears an emptied field with null', async () => {
    const calls = api({
      [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(current()),
      [`PATCH /api/v1/service-providers/${id}`]: () => jsonResponse(current({ version: 4 })),
    });
    const user = userEvent.setup();
    renderApp(`/service-providers/${id}/edit`);

    await user.click(await screen.findByRole('button', { name: 'Odebrat výrobce La Marzocco' }));
    await user.clear(screen.getByLabelText('Kontaktní osoba'));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await screen.findByRole('heading', { level: 1, name: 'Servis Novák s.r.o.' });
    expect(await bodyOf(calls, 'PATCH', `/api/v1/service-providers/${id}`)).toEqual({
      contactPerson: null,
      manufacturerIds: [daikinId],
      version: 3,
    });
  });

  it('sends nothing when the brands are removed and added back', async () => {
    const calls = api({ [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(current()) });
    const user = userEvent.setup();
    renderApp(`/service-providers/${id}/edit`);

    await user.click(await screen.findByRole('button', { name: 'Odebrat výrobce La Marzocco' }));
    await user.click(screen.getByPlaceholderText('Přidat výrobce…'));
    await user.click(await screen.findByRole('button', { name: 'La Marzocco' }));
    await user.type(screen.getByLabelText('Poznámka'), ' ');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await screen.findByRole('heading', { level: 1, name: 'Servis Novák s.r.o.' });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('says so on a conflict and reloads the current data on request', async () => {
    let version = 3;
    const calls = api({
      [`GET /api/v1/service-providers/${id}`]: () =>
        jsonResponse(current({ version, name: version === 3 ? 'Servis Novák s.r.o.' : 'Servis Novák a syn' })),
      [`PATCH /api/v1/service-providers/${id}`]: () => problem(409, 'conflict'),
    });
    const user = userEvent.setup();
    renderApp(`/service-providers/${id}/edit`);

    await user.type(await screen.findByLabelText('Telefon'), '1');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Záznam mezitím někdo upravil.');

    version = 4;
    await user.click(screen.getByRole('button', { name: 'Načíst aktuální údaje' }));
    await waitFor(() => expect(screen.getByLabelText('Název')).toHaveValue('Servis Novák a syn'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'GET' && c.url.endsWith(`/service-providers/${id}`)).length).toBeGreaterThan(1);
  });

  it('does not open an archived supplier for editing', async () => {
    api({ [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(current({ archivedAt: '2026-05-01T00:00:00.000Z' })) });
    renderApp(`/service-providers/${id}/edit`);
    expect(await screen.findByText('Záznam je archivovaný.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('shows the not-found state for a supplier that does not exist', async () => {
    api({ [`GET /api/v1/service-providers/${id}`]: () => problem(404, 'not_found') });
    renderApp(`/service-providers/${id}/edit`);
    expect(await screen.findByText('Dodavatel nenalezen')).toBeInTheDocument();
  });

  it('does not let a reader in', async () => {
    api({ [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(current()) }, 'read');
    renderApp(`/service-providers/${id}/edit`);
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });
});

describe('where the form is reached from', () => {
  it('offers Přidat dodavatele on the Suppliers tab to writers and Upravit on the detail', async () => {
    api({ [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(providerDetail({ id })) });
    const { router } = renderApp('/?tab=suppliers');
    await userEvent.click(await screen.findByRole('link', { name: 'Přidat dodavatele' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/service-providers/new'));

    await router.navigate({ to: '/service-providers/$id', params: { id } });
    expect(await screen.findByRole('link', { name: 'Upravit' })).toHaveAttribute('href', `/service-providers/${id}/edit`);
  });

  it('hides both from readers', async () => {
    api({ [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(providerDetail({ id })) }, 'read');
    const { router } = renderApp('/?tab=suppliers');
    await screen.findByText('Zatím žádný dodavatel');
    expect(screen.queryByRole('link', { name: 'Přidat dodavatele' })).not.toBeInTheDocument();

    await router.navigate({ to: '/service-providers/$id', params: { id } });
    await screen.findByRole('heading', { name: 'Servis Novák s.r.o.', level: 1 });
    expect(screen.queryByRole('link', { name: 'Upravit' })).not.toBeInTheDocument();
  });

  it('does not offer Upravit for an archived supplier', async () => {
    api({ [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(providerDetail({ id, archivedAt: '2026-05-01T00:00:00.000Z' })) });
    renderApp(`/service-providers/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upravit' })).not.toBeInTheDocument();
  });
});
