import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, me, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

const ref = (code: string, name: string) => ({ id: crypto.randomUUID(), code, name });
const id = '5b1c6d2e-3f4a-4b5c-8d9e-0a1b2c3d4e5f';
const photo = (n: number) => ({
  id: crypto.randomUUID(),
  url: `https://storage.test/photo-${n}.jpg`,
  contentType: 'image/jpeg',
  width: 800,
  height: 600,
});

function detail(over: Record<string, unknown> = {}) {
  const place = ref('LOC-019', 'Teplá kuchyně');
  return {
    id,
    version: 1,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    code: 'INV-00042',
    name: 'Konvektomat',
    model: 'SCC 101',
    serialNumber: 'SN-7781',
    manufacturer: { id: crypto.randomUUID(), name: 'Rational' },
    location: place,
    path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí'), place],
    warrantyUntil: '2020-05-01',
    lastServiceOn: '2026-03-04',
    nextServiceOn: '2000-01-01',
    manufactureYear: 2018,
    registeredOn: '2019-05-01',
    documentsUrl: 'https://drive.google.com/drive/folders/abc',
    note: 'Pravidelně odvápňovat.',
    externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
    photos: [],
    ...over,
  };
}

/** An item's service history as the API answers it: newest first, with the total. */
const history = (rows: { id: string; performedOn: string; title: string }[], extra: { nextCursor?: string | null; total?: number } = {}) =>
  jsonResponse({ items: rows, nextCursor: extra.nextCursor ?? null, total: extra.total ?? rows.length });

const recordsPath = `GET /api/v1/items/${id}/service-records`;

const signedIn = (item: () => Response, records: (request: Request) => Response = () => history([])) =>
  stubApi({ 'GET /api/v1/me': () => jsonResponse(me), [`GET /api/v1/items/${id}`]: item, [recordsPath]: records });

describe('item detail', () => {
  it('opens an item without a location, the breadcrumb going straight from Lokality to the item', async () => {
    signedIn(() => jsonResponse(detail({ location: null, path: [] })));
    renderApp(`/items/${id}`);
    const nav = await screen.findByRole('navigation', { name: 'Umístění' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Lokality']);
    expect(within(nav).getByText('Konvektomat')).toHaveAttribute('aria-current', 'page');
  });

  it('shows every field, with badges for expired warranty and overdue service', async () => {
    signedIn(() => jsonResponse(detail()));
    renderApp(`/items/${id}`);

    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Elektrikář: EL-4821')).toBeInTheDocument();
    expect(screen.queryByText('Lokalita')).not.toBeInTheDocument();
    for (const text of ['Rational', 'SCC 101', 'SN-7781', '2018', '1. 5. 2019', '1. 5. 2020', '4. 3. 2026', 'Pravidelně odvápňovat.']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Záruka vypršela')).toBeInTheDocument();
    expect(screen.getByText('Po termínu')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Otevřít složku na Google Drive/ });
    expect(link).toHaveAttribute('href', 'https://drive.google.com/drive/folders/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('has a breadcrumb through the Locations tab and the location levels, ending at the item', async () => {
    signedIn(() => jsonResponse(detail()));
    renderApp(`/items/${id}`);
    const nav = await screen.findByRole('navigation', { name: 'Umístění' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Lokality',
      'Centrála Praha',
      'Přízemí',
      'Teplá kuchyně',
    ]);
    expect(within(nav).getByText('Konvektomat')).toHaveAttribute('aria-current', 'page');
  });

  it('takes the app name in the top bar back to the home page', async () => {
    signedIn(() => jsonResponse(detail()));
    const { router } = renderApp(`/items/${id}`);
    await screen.findByRole('heading', { name: 'Konvektomat' });
    await userEvent.click(screen.getByRole('link', { name: 'Evidence majetku' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('shows a dash for empty fields and omits the documents and note sections', async () => {
    signedIn(() =>
      jsonResponse(
        detail({
          externalIds: [],
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
        }),
      ),
    );
    renderApp(`/items/${id}`);
    await screen.findByRole('heading', { name: 'Konvektomat' });
    expect(screen.getAllByText('—')).toHaveLength(9);
    expect(screen.queryByText('Záruka vypršela')).not.toBeInTheDocument();
    expect(screen.queryByText('Dokumenty')).not.toBeInTheDocument();
    expect(screen.queryByText('Poznámka')).not.toBeInTheDocument();
  });

  it('marks an archived item', async () => {
    signedIn(() => jsonResponse(detail({ archivedAt: '2026-02-01T00:00:00.000Z' })));
    renderApp(`/items/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
  });

  it('scrolls all photos on a phone', async () => {
    signedIn(() => jsonResponse(detail({ photos: [photo(1), photo(2)] })));
    renderApp(`/items/${id}`);
    const list = await screen.findByRole('list', { name: 'Fotografie' });
    expect(within(list).getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([
      'Konvektomat, fotografie 1 z 2',
      'Konvektomat, fotografie 2 z 2',
    ]);
  });

  it('shows one large photo with thumbnails on a desktop and switches on click', async () => {
    stubWideScreen(true);
    signedIn(() => jsonResponse(detail({ photos: [photo(1), photo(2)] })));
    renderApp(`/items/${id}`);
    expect(await screen.findByRole('img', { name: 'Konvektomat, fotografie 1 z 2' })).toHaveAttribute(
      'src',
      'https://storage.test/photo-1.jpg',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zobrazit fotografii 2' }));
    expect(screen.getByRole('img', { name: 'Konvektomat, fotografie 2 z 2' })).toHaveAttribute(
      'src',
      'https://storage.test/photo-2.jpg',
    );
  });

  it('says the item does not exist on a 404, without a retry button', async () => {
    signedIn(() =>
      jsonResponse({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }, { status: 404, problem: true }),
    );
    renderApp(`/items/${id}`);
    expect(await screen.findByText('Položka nenalezena')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('shows an error with retry when the server fails, and loads again on retry', async () => {
    let calls = 0;
    signedIn(() =>
      ++calls === 1
        ? jsonResponse({ type: 'about:blank', title: 'x', status: 500, code: 'internal_error' }, { status: 500, problem: true })
        : jsonResponse(detail()),
    );
    renderApp(`/items/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByRole('heading', { name: 'Konvektomat' })).toBeInTheDocument();
  });

  it('is reached from the item list, and browser Back returns to the Items tab', async () => {
    const summary = { ...detail(), photos: undefined };
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/items': () => jsonResponse({ items: [summary], nextCursor: null, total: 1 }),
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
      [recordsPath]: () => history([]),
    });
    const { router } = renderApp('/?tab=items');
    await userEvent.click(await screen.findByRole('link', { name: /Konvektomat/ }));
    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/items/${id}`);

    router.history.back();
    expect(await screen.findByRole('tab', { name: 'Položky', selected: true })).toBeInTheDocument();
  });
});

describe('item detail: service history', () => {
  const rows = [
    { id: crypto.randomUUID(), performedOn: '2026-04-15', title: 'Výměna filtru a kontrola tlaku' },
    { id: crypto.randomUUID(), performedOn: '2025-11-02', title: 'Pravidelná roční prohlídka' },
  ];

  it('is the last section, after the note, with the dates above the history', async () => {
    signedIn(() => jsonResponse(detail()), () => history(rows));
    renderApp(`/items/${id}`);
    await screen.findByRole('heading', { name: 'Servis', level: 2 });
    const sections = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(sections.at(-1)).toBe('Servis');
    expect(sections.indexOf('Poznámka')).toBeLessThan(sections.indexOf('Servis'));
  });

  it('lists the records newest first with their date, each linking to its detail', async () => {
    signedIn(() => jsonResponse(detail()), () => history(rows));
    renderApp(`/items/${id}`);

    expect(await screen.findByRole('heading', { name: 'Historie servisu (2)', level: 3 })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Výměna filtru|Pravidelná roční/ });
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Výměna filtru a kontrola tlaku'),
      expect.stringContaining('Pravidelná roční prohlídka'),
    ]);
    expect(links[0]).toHaveAttribute('href', `/service-records/${rows[0]!.id}`);
    expect(screen.getByText('15. 4. 2026')).toBeInTheDocument();
    expect(screen.getByText('2. 11. 2025')).toBeInTheDocument();
  });

  it('shows the records as a table with headings on a wide screen', async () => {
    stubWideScreen(true);
    signedIn(() => jsonResponse(detail()), () => history(rows));
    renderApp(`/items/${id}`);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Název', 'Datum']);
    expect(within(table).getByRole('link', { name: 'Výměna filtru a kontrola tlaku' })).toBeInTheDocument();
  });

  it('says there is no history yet, also to a reader', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse({ ...me, role: 'read' }),
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
      [recordsPath]: () => history([]),
    });
    renderApp(`/items/${id}`);
    expect(await screen.findByText('Zatím žádný servisní záznam')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Historie servisu (0)', level: 3 })).toBeInTheDocument();
  });

  it('loads the next page on request and then offers no more', async () => {
    const more = { id: crypto.randomUUID(), performedOn: '2025-06-20', title: 'Oprava netěsnícího ventilu' };
    const calls = signedIn(
      () => jsonResponse(detail()),
      (request) =>
        new URL(request.url).searchParams.get('cursor') === 'next-page'
          ? history([more], { total: 3 })
          : history(rows, { nextCursor: 'next-page', total: 3 }),
    );
    renderApp(`/items/${id}`);
    expect(await screen.findByRole('heading', { name: 'Historie servisu (3)', level: 3 })).toBeInTheDocument();
    expect(screen.queryByText('Oprava netěsnícího ventilu')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Oprava netěsnícího ventilu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Načíst další' })).not.toBeInTheDocument();
    const listCalls = calls.filter((call) => new URL(call.url).pathname.endsWith('/service-records'));
    expect(listCalls.map((call) => new URL(call.url).searchParams.get('cursor'))).toEqual([null, 'next-page']);
  });

  it('shows an error with retry in the section while the rest of the item stays', async () => {
    let fail = true;
    signedIn(
      () => jsonResponse(detail()),
      () =>
        fail
          ? jsonResponse({ type: 'about:blank', title: 'x', status: 500, code: 'internal_error' }, { status: 500, problem: true })
          : history(rows),
    );
    renderApp(`/items/${id}`);
    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Výměna filtru a kontrola tlaku')).toBeInTheDocument();
  });
});

describe('item detail: archive and restore', () => {
  const archivedAt = '2026-02-01T00:00:00.000Z';

  /** The item answers as the server would: archived once the archive call went through. */
  function stateful(start: { id: string; version: number }, role = 'write', refuse?: Response) {
    let current: { version: number } & Record<string, unknown> = start;
    return stubApi({
      'GET /api/v1/me': () => jsonResponse({ ...me, role }),
      [`GET /api/v1/items/${id}`]: () => jsonResponse(current),
      [recordsPath]: () => history([]),
      // Like the API: the item without its photos, not the detail.
      [`POST /api/v1/items/${id}/archive`]: () => {
        if (refuse) return refuse;
        current = { ...current, archivedAt, version: current.version + 1 };
        const { photos: _photos, ...item } = current;
        return jsonResponse(item);
      },
      [`POST /api/v1/items/${id}/restore`]: () => {
        current = { ...current, archivedAt: null, version: current.version + 1 };
        const { photos: _photos, ...item } = current;
        return jsonResponse(item);
      },
    });
  }

  it('asks first, then archives with the current version and offers Restore instead of Edit', async () => {
    const calls = stateful(detail({ version: 3, photos: [photo(1)] }));
    renderApp(`/items/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));

    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('Archivovat položku?')).toBeInTheDocument();
    expect(dialog.getByText(/externí ID zůstanou rezervovaná/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await userEvent.click(dialog.getByRole('button', { name: 'Archivovat' }));

    expect(await screen.findByRole('button', { name: 'Obnovit' })).toBeInTheDocument();
    expect(screen.getByText('Archivováno')).toBeInTheDocument();
    // The photos are still there: the detail was fetched again, not replaced by the answer.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Upravit' })).not.toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST')!;
    expect(new URL(post.url).pathname).toBe(`/api/v1/items/${id}/archive`);
    expect(JSON.parse(await post.clone().text())).toEqual({ version: 3 });
  });

  it('sends nothing when the dialog is cancelled', async () => {
    const calls = stateful(detail());
    renderApp(`/items/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zrušit' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('restores an archived item at once', async () => {
    const calls = stateful(detail({ archivedAt, version: 5 }));
    renderApp(`/items/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Obnovit' }));

    expect(await screen.findByRole('link', { name: 'Upravit' })).toBeInTheDocument();
    expect(screen.queryByText('Archivováno')).not.toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST')!;
    expect(new URL(post.url).pathname).toBe(`/api/v1/items/${id}/restore`);
    expect(JSON.parse(await post.clone().text())).toEqual({ version: 5 });
  });

  it('shows the conflict text when somebody changed the item meanwhile', async () => {
    const conflict = { type: 'about:blank', title: 'Conflict', status: 409, code: 'conflict' };
    stateful(detail(), 'write', jsonResponse(conflict, { status: 409, problem: true }));
    renderApp(`/items/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivovat' }));
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
  });

  it('offers a reader neither archive nor restore', async () => {
    stateful(detail({ archivedAt }), 'read');
    renderApp(`/items/${id}`);
    await screen.findByText('Archivováno');
    expect(screen.queryByRole('button', { name: /Archivovat|Obnovit/ })).not.toBeInTheDocument();
  });
});
