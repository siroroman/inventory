import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { today } from '../src/features/service-records/service-record-form-values.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const itemId = '5b1c6d2e-3f4a-4b5c-8d9e-0a1b2c3d4e5f';
const id = '7a2d9e41-5c3b-4e8f-9a60-1b2c3d4e5f60';

const itemRef = { id: itemId, code: 'INV-00042', name: 'Kávovar Linea PB', archivedAt: null };

function itemDetail(over: Record<string, unknown> = {}) {
  return {
    ...itemRef,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    location: null,
    path: [],
    manufacturer: null,
    model: null,
    serialNumber: null,
    manufactureYear: null,
    registeredOn: null,
    warrantyUntil: null,
    lastServiceOn: null,
    nextServiceOn: null,
    documentsUrl: null,
    note: null,
    externalIds: [],
    photos: [],
    ...over,
  };
}

function record(over: Record<string, unknown> = {}) {
  return {
    id,
    version: 3,
    archivedAt: null,
    createdAt: '2026-04-15T08:00:00.000Z',
    updatedAt: '2026-04-15T08:00:00.000Z',
    performedOn: '2026-04-15',
    title: 'Výměna filtru',
    performedBy: 'Servis Novák s.r.o.',
    responsiblePerson: 'Jan Novák',
    description: 'Vyměněn vodní filtr.',
    item: itemRef,
    ...over,
  };
}

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

/** Signed in as `role`, with the item and its (empty) history, which the screens after a save show. */
function api(routes: Parameters<typeof stubApi>[0] = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/items/${itemId}`]: () => jsonResponse(itemDetail()),
    [`GET /api/v1/items/${itemId}/service-records`]: () => jsonResponse({ items: [], nextCursor: null, total: 0 }),
    ...routes,
  });
}

const bodyOf = (calls: Request[], method: string, path: string) =>
  calls
    .filter((c) => c.method === method && new URL(c.url).pathname === path)
    .at(-1)
    ?.clone()
    .json();

describe('new service record', () => {
  it('shows the item, starts with today and creates the record', async () => {
    const created = record({ id: crypto.randomUUID(), version: 1, title: 'Roční prohlídka' });
    const calls = api({
      [`POST /api/v1/items/${itemId}/service-records`]: () => jsonResponse(created, { status: 201 }),
      [`GET /api/v1/service-records/${created.id}`]: () => jsonResponse(created),
    });
    const user = userEvent.setup();
    const { router } = renderApp(`/items/${itemId}/service-records/new`);

    expect(await screen.findByRole('heading', { name: 'Nový servisní záznam' })).toBeInTheDocument();
    expect(screen.getByText('Kávovar Linea PB')).toBeInTheDocument();
    expect(screen.getByLabelText('Datum')).toHaveValue(today());

    await user.clear(screen.getByLabelText('Datum'));
    await user.type(screen.getByLabelText('Datum'), '2026-04-15');
    await user.type(screen.getByLabelText('Název'), '  Roční prohlídka ');
    await user.type(screen.getByLabelText('Servis provedl'), 'Servis Novák s.r.o.');
    await user.type(screen.getByLabelText('Popis'), 'Bez závad.');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await screen.findByRole('heading', { name: 'Servisní záznam', level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/service-records/${created.id}`);
    expect(await screen.findByText('Uloženo')).toBeInTheDocument();
    expect(await bodyOf(calls, 'POST', `/api/v1/items/${itemId}/service-records`)).toEqual({
      performedOn: '2026-04-15',
      title: 'Roční prohlídka',
      performedBy: 'Servis Novák s.r.o.',
      responsiblePerson: null,
      description: 'Bez závad.',
    });
  });

  it('asks for the title and the date and sends nothing until they are there', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp(`/items/${itemId}/service-records/new`);

    await user.clear(await screen.findByLabelText('Datum'));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findAllByText('Vyplňte toto pole.')).toHaveLength(2);
    expect(screen.getByLabelText('Název')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows the error above the buttons when the server refuses the record', async () => {
    api({ [`POST /api/v1/items/${itemId}/service-records`]: () => problem(409, 'archived') });
    const user = userEvent.setup();
    renderApp(`/items/${itemId}/service-records/new`);
    await user.type(await screen.findByLabelText('Název'), 'Prohlídka');
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Záznam je archivovaný.');
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
  });

  it('refuses a reader', async () => {
    api({}, 'read');
    renderApp(`/items/${itemId}/service-records/new`);
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('says the item is archived', async () => {
    api({ [`GET /api/v1/items/${itemId}`]: () => jsonResponse(itemDetail({ archivedAt: '2026-05-01T00:00:00.000Z' })) });
    renderApp(`/items/${itemId}/service-records/new`);
    expect(await screen.findByText('Záznam je archivovaný.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('says the item does not exist', async () => {
    api({ [`GET /api/v1/items/${itemId}`]: () => problem(404, 'not_found') });
    renderApp(`/items/${itemId}/service-records/new`);
    expect(await screen.findByText('Položka nenalezena')).toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes, and not when nothing was typed', async () => {
    api();
    const user = userEvent.setup();
    renderApp(`/items/${itemId}/service-records/new`);

    await user.type(await screen.findByLabelText('Název'), 'Prohlídka');
    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Zahodit neuložené změny?' });
    await user.click(within(dialog).getByRole('button', { name: 'Zůstat na stránce' }));
    expect(screen.getByLabelText('Název')).toHaveValue('Prohlídka');

    await user.clear(screen.getByLabelText('Název'));
    await user.click(screen.getByRole('link', { name: 'Zrušit' }));
    expect(await screen.findByRole('heading', { name: 'Kávovar Linea PB', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('edit service record', () => {
  it('loads the record, keeps Save disabled until something changes and sends only the changes with the version', async () => {
    const calls = api({
      [`GET /api/v1/service-records/${id}`]: () => jsonResponse(record()),
      [`PATCH /api/v1/service-records/${id}`]: () => jsonResponse(record({ version: 4, title: 'Roční prohlídka' })),
    });
    const user = userEvent.setup();
    const { router } = renderApp(`/service-records/${id}/edit`);

    expect(await screen.findByRole('heading', { name: 'Upravit servisní záznam' })).toBeInTheDocument();
    expect(screen.getByLabelText('Datum')).toHaveValue('2026-04-15');
    expect(screen.getByLabelText('Název')).toHaveValue('Výměna filtru');
    expect(screen.getByLabelText('Servis provedl')).toHaveValue('Servis Novák s.r.o.');
    expect(screen.getByLabelText('Zodpovědná osoba')).toHaveValue('Jan Novák');
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Název'));
    await user.type(screen.getByLabelText('Název'), 'Roční prohlídka');
    await user.clear(screen.getByLabelText('Zodpovědná osoba'));
    await user.click(screen.getByRole('button', { name: 'Uložit' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/service-records/${id}`));
    expect(await bodyOf(calls, 'PATCH', `/api/v1/service-records/${id}`)).toEqual({
      title: 'Roční prohlídka',
      responsiblePerson: null,
      version: 3,
    });
  });

  it('shows the conflict text and loads the current data on request', async () => {
    let current = record();
    api({
      [`GET /api/v1/service-records/${id}`]: () => jsonResponse(current),
      [`PATCH /api/v1/service-records/${id}`]: () => problem(409, 'conflict'),
    });
    const user = userEvent.setup();
    renderApp(`/service-records/${id}/edit`);

    await user.type(await screen.findByLabelText('Název'), ' 2');
    current = record({ version: 4, title: 'Změněno kolegou' });
    await user.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Záznam mezitím někdo upravil.');

    await user.click(screen.getByRole('button', { name: 'Načíst aktuální údaje' }));
    await waitFor(() => expect(screen.getByLabelText('Název')).toHaveValue('Změněno kolegou'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a reader', async () => {
    api({ [`GET /api/v1/service-records/${id}`]: () => jsonResponse(record()) }, 'read');
    renderApp(`/service-records/${id}/edit`);
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('says a record of an archived item cannot be edited', async () => {
    const archivedItem = { ...itemRef, archivedAt: '2026-05-01T00:00:00.000Z' };
    api({ [`GET /api/v1/service-records/${id}`]: () => jsonResponse(record({ item: archivedItem })) });
    renderApp(`/service-records/${id}/edit`);
    expect(await screen.findByText('Záznam je archivovaný.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('says an archived record cannot be edited', async () => {
    api({ [`GET /api/v1/service-records/${id}`]: () => jsonResponse(record({ archivedAt: '2026-05-01T00:00:00.000Z' })) });
    renderApp(`/service-records/${id}/edit`);
    expect(await screen.findByText('Záznam je archivovaný.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Název')).not.toBeInTheDocument();
  });

  it('says the record does not exist', async () => {
    api({ [`GET /api/v1/service-records/${id}`]: () => problem(404, 'not_found') });
    renderApp(`/service-records/${id}/edit`);
    expect(await screen.findByText('Servisní záznam nenalezen')).toBeInTheDocument();
  });
});
