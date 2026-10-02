import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const id = '7a2d9e41-5c3b-4e8f-9a60-1b2c3d4e5f60';
const itemId = '5b1c6d2e-3f4a-4b5c-8d9e-0a1b2c3d4e5f';

function record(over: Record<string, unknown> = {}) {
  return {
    id,
    version: 1,
    archivedAt: null,
    createdAt: '2026-04-15T08:00:00.000Z',
    updatedAt: '2026-04-15T08:00:00.000Z',
    performedOn: '2026-04-15',
    title: 'Výměna filtru a kontrola tlaku',
    performedBy: 'Servis Novák s.r.o.',
    responsiblePerson: 'Jan Novák',
    description: 'Vyměněn vodní filtr.\nTlak bojleru 9,2 bar.',
    item: { id: itemId, code: 'INV-00042', name: 'Kávovar Linea PB', archivedAt: null },
    ...over,
  };
}

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

function signedIn(current: () => Response, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/service-records/${id}`]: current,
  });
}

describe('service record detail', () => {
  it('shows every field, the item as a link and the description with its line breaks', async () => {
    signedIn(() => jsonResponse(record()));
    renderApp(`/service-records/${id}`);

    expect(await screen.findByRole('heading', { name: 'Servisní záznam', level: 1 })).toBeInTheDocument();
    for (const text of ['15. 4. 2026', 'Výměna filtru a kontrola tlaku', 'Servis Novák s.r.o.', 'Jan Novák']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Kávovar Linea PB' })).toHaveAttribute('href', `/items/${itemId}`);
    expect(screen.getByRole('link', { name: /Zpět na položku Kávovar Linea PB/ })).toHaveAttribute('href', `/items/${itemId}`);
    expect(screen.getByRole('heading', { name: 'Popis', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Vyměněn vodní filtr\./)).toHaveTextContent('Vyměněn vodní filtr. Tlak bojleru 9,2 bar.');
  });

  it('shows a dash for empty fields and leaves out the description section', async () => {
    signedIn(() => jsonResponse(record({ performedBy: null, responsiblePerson: null, description: null })));
    renderApp(`/service-records/${id}`);
    await screen.findByRole('heading', { name: 'Servisní záznam' });
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Popis' })).not.toBeInTheDocument();
  });

  it('asks first, then archives with the current version and returns to the item', async () => {
    const calls = stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/service-records/${id}`]: () => jsonResponse(record({ version: 4 })),
      [`POST /api/v1/service-records/${id}/archive`]: () => jsonResponse(record({ version: 5, archivedAt: '2026-05-01T00:00:00.000Z' })),
      [`GET /api/v1/items/${itemId}`]: () =>
        jsonResponse({
          id: itemId,
          version: 1,
          archivedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          code: 'INV-00042',
          name: 'Kávovar Linea PB',
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
        }),
      [`GET /api/v1/items/${itemId}/service-records`]: () => jsonResponse({ items: [], nextCursor: null, total: 0 }),
    });
    const { router } = renderApp(`/service-records/${id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Archivovat servisní záznam?')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Archivovat' }));
    expect(await screen.findByRole('heading', { name: 'Kávovar Linea PB', level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/items/${itemId}`);
    const post = calls.find((call) => call.method === 'POST')!;
    expect(JSON.parse(await post.clone().text())).toEqual({ version: 4 });
  });

  it('sends nothing when the dialog is cancelled', async () => {
    const calls = signedIn(() => jsonResponse(record()));
    renderApp(`/service-records/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zrušit' }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows the conflict text and stays on the record when somebody changed it meanwhile', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/service-records/${id}`]: () => jsonResponse(record()),
      [`POST /api/v1/service-records/${id}/archive`]: () => problem(409, 'conflict'),
    });
    renderApp(`/service-records/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivovat' }));
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Servisní záznam', level: 1 })).toBeInTheDocument();
  });

  it('offers a reader no buttons', async () => {
    signedIn(() => jsonResponse(record()), 'read');
    renderApp(`/service-records/${id}`);
    await screen.findByRole('heading', { name: 'Servisní záznam' });
    expect(screen.queryByRole('button', { name: 'Archivovat' })).not.toBeInTheDocument();
  });

  it('marks an archived record and offers no buttons for it', async () => {
    signedIn(() => jsonResponse(record({ archivedAt: '2026-05-01T00:00:00.000Z' })));
    renderApp(`/service-records/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archivovat|Obnovit/ })).not.toBeInTheDocument();
  });

  it('offers no buttons for a record of an archived item', async () => {
    signedIn(() => jsonResponse(record({ item: { id: itemId, code: 'INV-00042', name: 'Kávovar', archivedAt: '2026-05-01T00:00:00.000Z' } })));
    renderApp(`/service-records/${id}`);
    await screen.findByRole('heading', { name: 'Servisní záznam' });
    expect(screen.queryByRole('button', { name: 'Archivovat' })).not.toBeInTheDocument();
  });

  it('says the record does not exist on a 404, without a retry button', async () => {
    signedIn(() => problem(404, 'not_found'));
    renderApp(`/service-records/${id}`);
    expect(await screen.findByText('Servisní záznam nenalezen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('shows an error with retry when the server fails, and loads again on retry', async () => {
    let fail = true;
    signedIn(() => (fail ? problem(500, 'internal_error') : jsonResponse(record())));
    renderApp(`/service-records/${id}`);
    const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Výměna filtru a kontrola tlaku')).toBeInTheDocument();
  });
});
