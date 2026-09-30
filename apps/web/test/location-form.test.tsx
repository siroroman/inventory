import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { location, page, record, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const hq = ref('LOC-001', 'Centrála Praha');
const floor = ref('LOC-004', 'Přízemí');
const types = [
  { ...record, id: crypto.randomUUID(), code: 'HQ', name: 'Centrála', sortOrder: 1 },
  { ...record, id: crypto.randomUUID(), code: 'STORE', name: 'Prodejna', sortOrder: 2 },
];

const problem = (code: string, status: number) =>
  jsonResponse({ type: 'about:blank', title: 'Error', status, code }, { status, problem: true });

type Handler = (request: Request) => Response | Promise<Response>;

/** Signed in (role `write` unless told otherwise) with the lists every form screen asks for. */
function api(routes: Record<string, Handler> = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    'GET /api/v1/location-types': () => jsonResponse({ items: types }),
    'GET /api/v1/locations': () => page([]),
    ...routes,
  });
}

const bodyOf = (calls: Request[], method: string) =>
  calls.find((call) => call.method === method)?.clone().json();

/** The location the API answers after a save: what was sent plus the ids the server adds. */
const saved = (over: Record<string, unknown> = {}) => location({ name: 'Nový sklad', type: null, path: [hq], ...over });

/** The "Saved" toast (sonner renders the text twice: the toast and its live region). */
const savedToast = () => screen.findAllByText('Uloženo');

afterEach(() => vi.restoreAllMocks());

describe('location form: adding', () => {
  it('creates a top-level location, then opens its detail with a "Saved" toast', async () => {
    const created = saved({ id: crypto.randomUUID(), parentId: null, type: types[1] && ref('STORE', 'Prodejna') });
    const calls = api({
      'POST /api/v1/locations': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/locations/${created.id}`]: () => jsonResponse(created),
      [`GET /api/v1/locations/${created.id}/items`]: () => page([]),
    });
    renderApp('/locations/new');

    expect(await screen.findByRole('heading', { level: 1, name: 'Nová lokalita' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Název'), '  Nový sklad  ');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Prodejna');
    await userEvent.type(screen.getByLabelText('Adresa'), 'Dlouhá 1');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Nový sklad' })).toBeInTheDocument();
    await savedToast();
    // Trimmed, empty note is null, no parent.
    expect(await bodyOf(calls, 'POST')).toEqual({
      name: 'Nový sklad',
      parentId: null,
      locationTypeId: types[1]!.id,
      address: 'Dlouhá 1',
      note: null,
    });
  });

  it('sends the ID the user typed, and none when the field is left empty', async () => {
    const created = saved();
    const calls = api({
      'POST /api/v1/locations': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/locations/${created.id}`]: () => jsonResponse(created),
      [`GET /api/v1/locations/${created.id}/items`]: () => page([]),
    });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('ID'), ' sklad-a ');
    await userEvent.type(screen.getByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await savedToast();
    expect(await bodyOf(calls, 'POST')).toMatchObject({ code: 'sklad-a' });
  });

  it('does not blame an empty ID field when the automatic number clashes', async () => {
    api({ 'POST /api/v1/locations': () => problem('duplicate_location_code', 409) });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ID se nepodařilo přidělit automaticky');
    expect(screen.getByLabelText('ID')).toBeValid();
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
  });

  it('rejects an ID the API would refuse', async () => {
    const calls = api();
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('ID'), 'špatné id');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText(/ID může mít nejvýše 30 znaků/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('marks the ID field when the ID is taken, until it is changed', async () => {
    api({ 'POST /api/v1/locations': () => problem('duplicate_location_code', 409) });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('ID'), 'SKLAD-A');
    await userEvent.type(screen.getByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Lokalita s tímto ID už existuje.')).toBeInTheDocument();
    expect(screen.getByLabelText('ID')).toBeInvalid();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('ID'), '2');
    await waitFor(() => expect(screen.queryByText('Lokalita s tímto ID už existuje.')).not.toBeInTheDocument());
  });

  it('puts the API\'s field errors on the fields it names', async () => {
    api({
      'POST /api/v1/locations': () =>
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            code: 'validation_error',
            details: { target: 'json', issues: [{ path: 'address', message: 'Too big' }] },
          },
          { status: 400, problem: true },
        ),
    });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Hodnota není platná.')).toBeInTheDocument();
    expect(screen.getByLabelText('Adresa')).toBeInvalid();
    expect(screen.getByLabelText('Název')).toBeValid();
    // The message is next to the field, so the general one is not repeated.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the general message when the API names no field', async () => {
    api({ 'POST /api/v1/locations': () => problem('validation_error', 400) });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Zkontrolujte prosím vyplněné údaje.');
  });

  it('names the missing fields and sends nothing', async () => {
    const calls = api();
    renderApp('/locations/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Uložit' }));

    expect(await screen.findByText('Zadejte název.')).toBeInTheDocument();
    expect(screen.getByText('Vyberte typ lokality.')).toBeInTheDocument();
    expect(screen.getByLabelText('Název')).toBeInvalid();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('rejects text longer than the API accepts', async () => {
    api();
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'x'.repeat(121));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText('Název může mít nejvýše 120 znaků.')).toBeInTheDocument();
  });

  it('starts a sub-location under ?parentId=, without a type', async () => {
    const parent = location({ id: floor.id, name: 'Přízemí', type: null, parentId: hq.id, path: [hq, floor] });
    const created = saved({ parentId: floor.id, path: [hq, floor, ref('LOC-020', 'Kuchyně')] });
    const calls = api({
      [`GET /api/v1/locations/${floor.id}`]: () => jsonResponse(parent),
      'POST /api/v1/locations': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/locations/${created.id}`]: () => jsonResponse(created),
      [`GET /api/v1/locations/${created.id}/items`]: () => page([]),
    });
    renderApp(`/locations/new?parentId=${floor.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Nová podlokalita' })).toBeInTheDocument();
    expect(screen.getByText('Centrála Praha › Přízemí')).toBeInTheDocument();
    expect(screen.queryByLabelText('Typ')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Název'), 'Kuchyně');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await savedToast();
    expect(await bodyOf(calls, 'POST')).toEqual({
      name: 'Kuchyně',
      parentId: floor.id,
      locationTypeId: null,
      address: null,
      note: null,
    });
  });

  it('shows the not-found page for a parent that does not exist', async () => {
    const missing = crypto.randomUUID();
    api({ [`GET /api/v1/locations/${missing}`]: () => problem('not_found', 404) });
    renderApp(`/locations/new?parentId=${missing}`);
    expect(await screen.findByText('Stránka nenalezena')).toBeInTheDocument();
  });

  it('will not start a sub-location under an archived parent', async () => {
    const parent = location({ archivedAt: '2026-05-01T00:00:00.000Z' });
    api({ [`GET /api/v1/locations/${parent.id}`]: () => jsonResponse(parent) });
    renderApp(`/locations/new?parentId=${parent.id}`);
    expect(await screen.findByText('Nadřazená lokalita je archivovaná.')).toBeInTheDocument();
  });

  it('shows the API error above the buttons and keeps what was typed', async () => {
    api({ 'POST /api/v1/locations': () => problem('location_type_not_found', 422) });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Typ lokality neexistuje.');
    expect(screen.getByLabelText('Název')).toHaveValue('Sklad');
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
  });
});

describe('location form: choosing the parent', () => {
  it('searches all levels by name and takes the chosen path as the parent', async () => {
    const calls = api({
      'GET /api/v1/locations': (request) =>
        new URL(request.url).searchParams.get('q')
          ? page([location({ name: 'Přízemí', type: null, parentId: hq.id, path: [hq, floor] })])
          : page([location({ name: 'Centrála Praha' })]),
    });
    renderApp('/locations/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));

    // Nothing typed: the top level is offered, with "none" first.
    const options = await screen.findAllByRole('button', { name: /Centrála Praha|Žádná/ });
    expect(options.map((option) => option.textContent)).toEqual(['Žádná (lokalita nejvyšší úrovně)', 'Centrála Praha']);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Hledat nadřazenou lokalitu' }), 'prizemi');
    await userEvent.click(await screen.findByRole('button', { name: 'Centrála Praha › Přízemí' }));

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Změnit' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Centrála Praha › Přízemí')).toBeInTheDocument();
    // A sub-location has no type field.
    expect(screen.queryByLabelText('Typ')).not.toBeInTheDocument();
    const searches = calls
      .filter((call) => new URL(call.url).pathname === '/api/v1/locations')
      .map((call) => new URL(call.url).searchParams.get('q'));
    expect(searches).toContain('prizemi');
  });

  it('does not submit the form when Enter is pressed in the search field', async () => {
    const calls = api();
    renderApp('/locations/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));
    await userEvent.type(screen.getByRole('searchbox'), 'sklad{Enter}');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    // Nor did the empty form report its errors.
    expect(screen.queryByText('Zadejte název.')).not.toBeInTheDocument();
  });

  it('goes back to top level with "none", which asks for the type again', async () => {
    const parent = location({ id: floor.id, name: 'Přízemí', type: null, parentId: hq.id, path: [hq, floor] });
    api({ [`GET /api/v1/locations/${floor.id}`]: () => jsonResponse(parent) });
    renderApp(`/locations/new?parentId=${floor.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Žádná (lokalita nejvyšší úrovně)' }));
    expect(await screen.findByLabelText('Typ')).toBeInTheDocument();
  });

  it('does not offer the edited location as its own parent', async () => {
    const edited = location({ name: 'Přízemí', type: null, parentId: hq.id, path: [hq, ref('LOC-004', 'Přízemí')] });
    api({
      [`GET /api/v1/locations/${edited.id}`]: () => jsonResponse(edited),
      'GET /api/v1/locations': () => page([location({ name: 'Centrála Praha' }), edited]),
    });
    renderApp(`/locations/${edited.id}/edit`);
    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));
    expect(await screen.findByRole('button', { name: 'Centrála Praha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Centrála Praha › Přízemí' })).not.toBeInTheDocument();
  });
});

describe('location form: editing', () => {
  const top = location({ id: hq.id, name: 'Centrála Praha', type: ref('HQ', 'Centrála'), address: 'Vinohradská 12', note: 'Stará poznámka' });
  top.type.id = types[0]!.id;

  const detail = (current: Record<string, unknown>) => ({
    [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse(current),
    [`GET /api/v1/locations/${hq.id}/items`]: () => page([]),
  });

  it('fills the form with the location and saves the change with its version', async () => {
    const after = { ...top, name: 'Centrála', version: 2 };
    const calls = api({ ...detail(top), [`PATCH /api/v1/locations/${hq.id}`]: () => jsonResponse(after) });
    renderApp(`/locations/${hq.id}/edit`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Upravit lokalitu' })).toBeInTheDocument();
    expect(screen.getByLabelText('Název')).toHaveValue('Centrála Praha');
    // The ID is shown but cannot be changed.
    expect(screen.getByLabelText('ID')).toHaveValue('LOC-001');
    expect(screen.getByLabelText('ID')).toBeDisabled();
    expect(await screen.findByLabelText('Typ')).toHaveValue(types[0]!.id);
    expect(screen.getByLabelText('Adresa')).toHaveValue('Vinohradská 12');
    expect(screen.getByLabelText('Poznámka')).toHaveValue('Stará poznámka');
    expect(screen.getByText('Žádná (lokalita nejvyšší úrovně)')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Název'));
    await userEvent.type(screen.getByLabelText('Název'), 'Centrála');
    await userEvent.clear(screen.getByLabelText('Poznámka'));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await savedToast();
    expect(await bodyOf(calls, 'PATCH')).toEqual({
      name: 'Centrála',
      parentId: null,
      locationTypeId: types[0]!.id,
      address: 'Vinohradská 12',
      note: null,
      version: 1,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Centrála Praha' })).toBeInTheDocument();
  });

  it('moves a top-level location under a parent and drops its type', async () => {
    const calls = api({
      ...detail(top),
      'GET /api/v1/locations': () => page([location({ id: floor.id, name: 'Sklad', path: [ref('LOC-009', 'Sklad')] })]),
      [`PATCH /api/v1/locations/${hq.id}`]: () => jsonResponse({ ...top, version: 2 }),
    });
    renderApp(`/locations/${hq.id}/edit`);
    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sklad' }));
    expect(screen.queryByLabelText('Typ')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await savedToast();
    expect(await bodyOf(calls, 'PATCH')).toMatchObject({ parentId: floor.id, locationTypeId: null, version: 1 });
  });

  it('says so when the location was changed meanwhile, and reloads the current data on request', async () => {
    let answers = 0;
    const current = { ...top, name: 'Přejmenováno jinde', version: 2 };
    const calls = api({
      [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse(answers === 0 ? top : current),
      [`GET /api/v1/locations/${hq.id}/items`]: () => page([]),
      [`PATCH /api/v1/locations/${hq.id}`]: () => {
        answers++;
        return answers === 1 ? problem('conflict', 409) : jsonResponse({ ...current, version: 3 });
      },
    });
    renderApp(`/locations/${hq.id}/edit`);
    await userEvent.type(await screen.findByLabelText('Adresa'), ' (nově)');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Záznam mezitím někdo upravil.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Načíst aktuální údaje' }));

    await waitFor(() => expect(screen.getByLabelText('Název')).toHaveValue('Přejmenováno jinde'));
    expect(screen.getByLabelText('Adresa')).toHaveValue('Vinohradská 12');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await savedToast();
    const patches = calls.filter((call) => call.method === 'PATCH');
    expect(await patches[0]!.clone().json()).toMatchObject({ version: 1 });
    expect(await patches[1]!.clone().json()).toMatchObject({ version: 2 });
  });

  it('starts from the server copy, not from the detail page it came from', async () => {
    let served = top;
    api({
      [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse(served),
      [`GET /api/v1/locations/${hq.id}/items`]: () => page([]),
    });
    renderApp(`/locations/${hq.id}`);
    const edit = await screen.findByRole('link', { name: 'Upravit' });
    // Someone else renames it while the detail is open (still fresh in the cache).
    served = { ...top, name: 'Přejmenováno jinde', version: 2 };
    await userEvent.click(edit);
    expect(await screen.findByLabelText('Název')).toHaveValue('Přejmenováno jinde');
  });

  it('shows the not-found page for an unknown location', async () => {
    const missing = crypto.randomUUID();
    api({ [`GET /api/v1/locations/${missing}`]: () => problem('not_found', 404) });
    renderApp(`/locations/${missing}/edit`);
    expect(await screen.findByText('Stránka nenalezena')).toBeInTheDocument();
  });

  it('offers a retry when the location cannot be loaded', async () => {
    let asked = 0;
    api({
      [`GET /api/v1/locations/${hq.id}`]: () => (asked++ === 0 ? problem('internal_error', 500) : jsonResponse(top)),
    });
    renderApp(`/locations/${hq.id}/edit`);
    await userEvent.click(await screen.findByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByLabelText('Název')).toHaveValue('Centrála Praha');
  });

  it('will not edit an archived location', async () => {
    api(detail({ ...top, archivedAt: '2026-05-01T00:00:00.000Z' }));
    renderApp(`/locations/${hq.id}/edit`);
    expect(await screen.findByText('Záznam je archivovaný.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });
});

describe('location form: unsaved changes', () => {
  it('asks before leaving a changed form, and stays when the answer is no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    api();
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Rozdělané');
    await userEvent.click(screen.getByRole('link', { name: 'Zrušit' }));

    expect(confirm).toHaveBeenCalledWith('Máte neuložené změny. Opravdu chcete stránku opustit?');
    expect(screen.getByLabelText('Název')).toHaveValue('Rozdělané');
  });

  it('leaves when the answer is yes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api();
    const { router } = renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Rozdělané');
    await userEvent.click(screen.getByRole('link', { name: 'Zrušit' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('leaves an untouched form without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    api();
    const { router } = renderApp('/locations/new');
    await userEvent.click(await screen.findByRole('link', { name: 'Zrušit' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not ask after a successful save', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const created = saved();
    api({
      'POST /api/v1/locations': () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/locations/${created.id}`]: () => jsonResponse(created),
      [`GET /api/v1/locations/${created.id}/items`]: () => page([]),
    });
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Sklad');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Centrála');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('heading', { level: 1, name: 'Nový sklad' });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('location form: roles', () => {
  it('refuses the read role on both form screens', async () => {
    api({}, 'read');
    renderApp('/locations/new');
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('refuses the read role on the edit screen without loading the location', async () => {
    const calls = api({}, 'read');
    renderApp(`/locations/${hq.id}/edit`);
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(calls.some((call) => new URL(call.url).pathname === `/api/v1/locations/${hq.id}`)).toBe(false);
  });

  it('offers "Přidat lokalitu" on Home to writers only', async () => {
    api();
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Přidat lokalitu' })).toHaveAttribute('href', '/locations/new');
  });

  it('hides "Přidat lokalitu" from the read role', async () => {
    api({}, 'read');
    renderApp('/');
    await screen.findByRole('heading', { level: 2, name: 'Lokality' });
    expect(screen.queryByRole('link', { name: 'Přidat lokalitu' })).not.toBeInTheDocument();
  });

  const place = location({ id: hq.id });
  const detailRoutes = {
    [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse(place),
    [`GET /api/v1/locations/${hq.id}/items`]: () => page([]),
  };

  it('links Edit and Add sub-location on the detail for writers', async () => {
    api(detailRoutes);
    renderApp(`/locations/${hq.id}`);
    expect(await screen.findByRole('link', { name: 'Upravit' })).toHaveAttribute('href', `/locations/${hq.id}/edit`);
    expect(screen.getByRole('link', { name: 'Přidat podlokalitu' })).toHaveAttribute(
      'href',
      `/locations/new?parentId=${hq.id}`,
    );
  });

  it('hides them from the read role and on an archived location', async () => {
    api(detailRoutes, 'read');
    renderApp(`/locations/${hq.id}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: /Upravit|Přidat/ })).not.toBeInTheDocument();
  });

  it('hides them on an archived location', async () => {
    api({ ...detailRoutes, [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse({ ...place, archivedAt: '2026-05-01T00:00:00.000Z' }) });
    renderApp(`/locations/${hq.id}`);
    await screen.findByText('Archivováno');
    expect(screen.queryByRole('link', { name: /Upravit|Přidat/ })).not.toBeInTheDocument();
  });
});
