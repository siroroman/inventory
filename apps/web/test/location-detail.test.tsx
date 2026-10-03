import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { item, location, page, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubScreenWidth, stubWideScreen } from './helpers.tsx';

const hq = ref('LOC-001', 'Centrála Praha');
const floor = ref('LOC-004', 'Přízemí');
const kitchen = ref('LOC-019', 'Teplá kuchyně');

/** A sub-location two levels down, with everything filled in. */
const sub = location({
  id: kitchen.id,
  code: 'LOC-019',
  name: 'Teplá kuchyně',
  parentId: floor.id,
  type: null,
  address: 'Vchod z dvora',
  note: 'Klíče u vrátného.\nDruhý řádek.',
  path: [hq, floor, kitchen],
  itemCount: 12,
  childCount: 2,
});

type Answers = {
  detail?: (request: Request) => Response | Promise<Response>;
  children?: (request: Request) => Response;
  items?: (request: Request) => Response;
};

/** Signed in; answers the detail of `loc` and the two lists under it. */
function api(loc: { id: string }, answers: Answers = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/locations/${loc.id}`]: answers.detail ?? (() => jsonResponse(loc)),
    'GET /api/v1/locations': answers.children ?? (() => page([])),
    [`GET /api/v1/locations/${loc.id}/items`]: answers.items ?? (() => page([])),
  });
}

const callsTo = (calls: Request[], path: string) =>
  calls.filter((call) => new URL(call.url).pathname === path).map((call) => new URL(call.url).searchParams);

describe('location detail: header and fields', () => {
  it('shows the name, the breadcrumb of the whole path and the fields', async () => {
    api(sub);
    renderApp(`/locations/${sub.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Teplá kuchyně' })).toBeInTheDocument();
    const crumbs = within(screen.getByRole('navigation', { name: 'Umístění' }));
    expect(crumbs.getByRole('link', { name: 'Lokality' })).toHaveAttribute('href', '/');
    expect(crumbs.getByRole('link', { name: 'Centrála Praha' })).toHaveAttribute('href', `/locations/${hq.id}`);
    expect(crumbs.getByRole('link', { name: 'Přízemí' })).toHaveAttribute('href', `/locations/${floor.id}`);
    // The location itself is where you are, not a link.
    expect(crumbs.getByText('Teplá kuchyně')).toHaveAttribute('aria-current', 'page');
    expect(crumbs.queryByRole('link', { name: 'Teplá kuchyně' })).not.toBeInTheDocument();

    expect(screen.getByText('LOC-019')).toBeInTheDocument();
    expect(screen.getByText('Vchod z dvora')).toBeInTheDocument();
    expect(screen.getByText(/Klíče u vrátného\./)).toBeInTheDocument();
    // The parent is a link, and a sub-location has no type row.
    expect(screen.getByText('Nadřazená lokalita').nextElementSibling).toContainElement(
      screen.getAllByRole('link', { name: 'Přízemí' })[1]!,
    );
    expect(screen.queryByText('Typ')).not.toBeInTheDocument();
  });

  it('shows the type and a dash for empty fields on a top-level location', async () => {
    const top = location({ address: null, note: null });
    api(top);
    renderApp(`/locations/${top.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Centrála Praha' })).toBeInTheDocument();
    const value = (label: string) => screen.getByText(label).nextElementSibling;
    expect(value('Typ')).toHaveTextContent('Centrála');
    expect(value('Nadřazená lokalita')).toHaveTextContent('—');
    expect(value('Adresa')).toHaveTextContent('—');
    expect(value('Poznámka')).toHaveTextContent('—');
  });

  it('marks an archived location', async () => {
    const archived = location({ archivedAt: '2026-05-01T00:00:00.000Z' });
    api(archived);
    renderApp(`/locations/${archived.id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
  });
});

describe('location detail: sub-locations and items', () => {
  it('lists the direct sub-locations and the items of the subtree, with the counts in the headings', async () => {
    const calls = api(sub, {
      children: () => page([location({ name: 'Lednice', type: null, address: null, path: [hq, floor, kitchen], itemCount: 3, childCount: 0 })]),
      items: () => page([item({ name: 'Konvektomat' })]),
    });
    renderApp(`/locations/${sub.id}`);

    expect(await screen.findByRole('heading', { level: 2, name: 'Podlokality (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Položky (12)' })).toBeInTheDocument();
    const child = await within(screen.getByRole('region', { name: 'Podlokality (2)' })).findByRole('listitem');
    const thing = await within(screen.getByRole('region', { name: 'Položky (12)' })).findByRole('listitem');
    expect(child).toHaveTextContent('Lednice');
    expect(child).toHaveTextContent('3 položky');
    // The parent path is the page's own breadcrumb, so a child does not repeat it.
    expect(child).not.toHaveTextContent('Přízemí');
    expect(thing).toHaveTextContent('Konvektomat');
    expect(thing).toHaveTextContent('Centrála Praha › Přízemí › Teplá kuchyně');

    expect(callsTo(calls, '/api/v1/locations')).toEqual([new URLSearchParams({ limit: '20', parentId: sub.id })]);
    expect(callsTo(calls, `/api/v1/locations/${sub.id}/items`)).toEqual([new URLSearchParams({ limit: '20' })]);
  });

  it('has no sub-locations section for a reader, and does not ask for them, when there are none', async () => {
    const leaf = { ...sub, childCount: 0 };
    const calls = api(leaf, {}, 'read');
    renderApp(`/locations/${leaf.id}`);
    expect(await screen.findByText('Žádné položky')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Podlokality/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Žádné podlokality')).not.toBeInTheDocument();
    expect(callsTo(calls, '/api/v1/locations')).toEqual([]);
  });

  it('keeps an empty sub-locations section for a writer, with an empty box and the button to add the first one', async () => {
    const leaf = { ...sub, childCount: 0 };
    const calls = api(leaf);
    renderApp(`/locations/${leaf.id}`);
    const section = within((await screen.findByRole('heading', { level: 2, name: 'Podlokality (0)' })).closest('section')!);
    expect(section.getByRole('link', { name: 'Přidat podlokalitu' })).toHaveAttribute('href', `/locations/new?parentId=${leaf.id}`);
    // The same empty box as the items have, without asking the API for a list that is known to be empty.
    expect(section.getByText('Žádné podlokality')).toBeInTheDocument();
    expect(section.getByText('Tato lokalita zatím nemá žádné podlokality.')).toBeInTheDocument();
    expect(callsTo(calls, '/api/v1/locations')).toEqual([]);
  });

  it('puts the add buttons in their own sections, not in the header', async () => {
    api(sub);
    renderApp(`/locations/${sub.id}`);
    const subs = within((await screen.findByRole('heading', { level: 2, name: 'Podlokality (2)' })).closest('section')!);
    const items = within((await screen.findByRole('heading', { level: 2, name: 'Položky (12)' })).closest('section')!);
    expect(subs.getByRole('link', { name: 'Přidat podlokalitu' })).toHaveAttribute('href', `/locations/new?parentId=${sub.id}`);
    expect(items.getByRole('link', { name: 'Přidat položku' })).toHaveAttribute('href', `/items/new?locationId=${sub.id}`);
    expect(screen.getAllByRole('link', { name: 'Přidat podlokalitu' })).toHaveLength(1);
  });

  it('shows no add buttons to a reader', async () => {
    api(sub, {}, 'read');
    renderApp(`/locations/${sub.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Položky (12)' });
    expect(screen.queryByRole('link', { name: /Přidat/ })).not.toBeInTheDocument();
  });

  it('loads more items with the cursor', async () => {
    const calls = api(sub, {
      items: (request) =>
        new URL(request.url).searchParams.get('cursor')
          ? page([item({ name: 'Druhá strana' })], { total: 2 })
          : page([item({ name: 'První strana' })], { nextCursor: 'abc', total: 2 }),
    });
    renderApp(`/locations/${sub.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Načíst další' }));
    expect(await screen.findByText('Druhá strana')).toBeInTheDocument();
    expect(callsTo(calls, `/api/v1/locations/${sub.id}/items`).at(-1)?.get('cursor')).toBe('abc');
  });

  it('shows both lists as tables on a wide screen', async () => {
    stubWideScreen(true);
    api(sub, { children: () => page([location({ name: 'Lednice' })]), items: () => page([item()]) });
    renderApp(`/locations/${sub.id}`);
    const children = await within(await screen.findByRole('region', { name: 'Podlokality (2)' })).findByRole('table');
    const items = await within(screen.getByRole('region', { name: 'Položky (12)' })).findByRole('table');
    expect(within(children).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Název',
      'ID',
      'Položky',
      'Podlokality',
    ]);
    const row = within(within(children).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(row.slice(0, 2)).toEqual(['Lednice', 'LOC-001']);
    expect(within(items).queryByRole('columnheader', { name: 'Servis' })).not.toBeInTheDocument();
    // Both tables give the name the same width, so their ID columns line up.
    expect(within(items).getByRole('columnheader', { name: 'Název' })).toHaveClass('w-80');
    expect(within(children).getByRole('columnheader', { name: 'Název' })).toHaveClass('w-80');
    expect(within(children).getByRole('columnheader', { name: 'ID' })).toHaveClass('w-44');
    expect(within(items).getByRole('columnheader', { name: 'ID' })).toHaveClass('w-44');
    // The rest is shared evenly by the columns without a set width: the two counts and an empty
    // column spanning two of them, as many as the items table has, so the divider after the counts
    // lines up with the location column below and the row lines reach the edge.
    const flexible = (table: HTMLElement) =>
      within(table).getAllByRole('columnheader').filter((h) => !/\bw-/.test(h.className)).length;
    expect(flexible(children)).toBe(2);
    expect(flexible(items)).toBe(2);
    for (const tr of children.querySelectorAll('tr')) {
      expect(tr.lastElementChild).toHaveAttribute('colspan', '2');
      expect(tr.lastElementChild).toBeEmptyDOMElement();
    }
  });

  it('gives the counts the whole rest of the row below 1024 px, without the empty column', async () => {
    stubScreenWidth(800);
    api(sub, { children: () => page([location({ name: 'Lednice' })]), items: () => page([item()]) });
    renderApp(`/locations/${sub.id}`);
    const children = await within(await screen.findByRole('region', { name: 'Podlokality (2)' })).findByRole('table');
    for (const tr of children.querySelectorAll('tr')) expect(tr.children).toHaveLength(4);
  });
});

describe('location detail: navigation', () => {
  it('opens a sub-location from the list', async () => {
    const child = location({ name: 'Lednice', type: null, parentId: sub.id, path: [hq, floor, kitchen, ref('LOC-020', 'Lednice')] });
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/locations/${sub.id}`]: () => jsonResponse(sub),
      [`GET /api/v1/locations/${child.id}`]: () => jsonResponse(child),
      'GET /api/v1/locations': () => page([child]),
      [`GET /api/v1/locations/${sub.id}/items`]: () => page([]),
      [`GET /api/v1/locations/${child.id}/items`]: () => page([]),
    });
    const { router } = renderApp(`/locations/${sub.id}`);

    await userEvent.click(await screen.findByRole('link', { name: /Lednice/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/locations/${child.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Lednice' })).toBeInTheDocument();
  });

  it('opens an ancestor from the breadcrumb', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/locations/${sub.id}`]: () => jsonResponse(sub),
      [`GET /api/v1/locations/${floor.id}`]: () => jsonResponse(location({ id: floor.id, name: 'Přízemí', path: [hq, floor] })),
      'GET /api/v1/locations': () => page([]),
      [`GET /api/v1/locations/${sub.id}/items`]: () => page([]),
      [`GET /api/v1/locations/${floor.id}/items`]: () => page([]),
    });
    const { router } = renderApp(`/locations/${sub.id}`);

    await userEvent.click(
      within(await screen.findByRole('navigation', { name: 'Umístění' })).getByRole('link', { name: 'Přízemí' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(`/locations/${floor.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Přízemí' })).toBeInTheDocument();
  });

  it('does not show the previous location\'s items while the next one loads, even with its detail cached', async () => {
    const parent = location({ id: floor.id, name: 'Přízemí', path: [hq, floor], childCount: 0, itemCount: 5 });
    let release: (res: Response) => void = () => {};
    const { queryClient, router } = (() => {
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/locations/${sub.id}`]: () => jsonResponse(sub),
        [`GET /api/v1/locations/${parent.id}`]: () => jsonResponse(parent),
        'GET /api/v1/locations': () => page([]),
        [`GET /api/v1/locations/${sub.id}/items`]: () => page([item({ name: 'Položka z kuchyně' })]),
        [`GET /api/v1/locations/${parent.id}/items`]: () => new Promise<Response>((resolve) => (release = resolve)) as never,
      });
      return renderApp(`/locations/${sub.id}`);
    })();
    queryClient.setQueryData(['locations', 'detail', parent.id], parent);
    expect(await screen.findByText('Položka z kuchyně')).toBeInTheDocument();

    await router.navigate({ to: '/locations/$id', params: { id: parent.id } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Přízemí' })).toBeInTheDocument();
    expect(screen.queryByText('Položka z kuchyně')).not.toBeInTheDocument();

    release(page([item({ name: 'Položka z přízemí' })]));
    expect(await screen.findByText('Položka z přízemí')).toBeInTheDocument();
  });

  it('is reached from a row on Home', async () => {
    const top = location();
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/locations': (request) =>
        new URL(request.url).searchParams.has('parentId') ? page([]) : page([top]),
      [`GET /api/v1/locations/${top.id}`]: () => jsonResponse(top),
      [`GET /api/v1/locations/${top.id}/items`]: () => page([]),
    });
    const { router } = renderApp('/');

    await userEvent.click(await screen.findByRole('link', { name: /Centrála Praha/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/locations/${top.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Centrála Praha' })).toBeInTheDocument();
  });

  it('makes the name a link in the desktop table too', async () => {
    stubWideScreen(true);
    const top = location();
    stubApi({ 'GET /api/v1/me': () => jsonResponse(me), 'GET /api/v1/locations': () => page([top]) });
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Centrála Praha' })).toHaveAttribute('href', `/locations/${top.id}`);
  });
});

describe('location detail: loading and failure', () => {
  it('shows a skeleton until the location arrives', async () => {
    let release: (res: Response) => void = () => {};
    api(sub, { detail: () => new Promise<Response>((resolve) => (release = resolve)) });
    renderApp(`/locations/${sub.id}`);
    expect(await screen.findByRole('status', { name: 'Načítání' }, { timeout: 2000 })).toBeInTheDocument();
    release(jsonResponse(sub));
    expect(await screen.findByRole('heading', { level: 1, name: 'Teplá kuchyně' })).toBeInTheDocument();
  });

  it('says the page does not exist for an unknown location, without a retry', async () => {
    api(sub, {
      detail: () =>
        jsonResponse({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }, { status: 404, problem: true }),
    });
    renderApp(`/locations/${sub.id}`);
    expect(await screen.findByText('Stránka nenalezena')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na úvodní stránku' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('treats an id that is not a UUID as a page that does not exist', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/locations/abc': () =>
        jsonResponse({ type: 'about:blank', title: 'Bad Request', status: 400, code: 'validation_error' }, { status: 400, problem: true }),
    });
    renderApp('/locations/abc');
    expect(await screen.findByText('Stránka nenalezena')).toBeInTheDocument();
  });

  it('shows the Czech error with a retry that loads the location', async () => {
    let failing = true;
    api(sub, {
      detail: () =>
        failing
          ? jsonResponse({ type: 'about:blank', title: 'Server Error', status: 500, code: 'internal_error' }, { status: 500, problem: true })
          : jsonResponse(sub),
    });
    renderApp(`/locations/${sub.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Něco se nepovedlo. Zkuste to prosím znovu.');
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Teplá kuchyně' })).toBeInTheDocument();
  });

  it('keeps the page and shows an error inside the items section when only the items fail', async () => {
    api(sub, {
      items: () =>
        jsonResponse({ type: 'about:blank', title: 'Server Error', status: 500, code: 'internal_error' }, { status: 500, problem: true }),
    });
    renderApp(`/locations/${sub.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Teplá kuchyně' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Něco se nepovedlo');
    expect(screen.getByRole('heading', { level: 2, name: 'Podlokality (2)' })).toBeInTheDocument();
  });
});

describe('location detail: archive and restore', () => {
  const archivedAt = '2026-05-01T00:00:00.000Z';
  const bodyOf = async (call: Request) => JSON.parse(await call.clone().text());

  /** The location answers as the server would: archived once the archive call went through. */
  function stateful(start: { id: string; version: number }, role = 'write', refuse?: Response) {
    let current: { version: number } & Record<string, unknown> = start;
    return stubApi({
      'GET /api/v1/me': () => jsonResponse({ ...me, role }),
      [`GET /api/v1/locations/${start.id}`]: () => jsonResponse(current),
      'GET /api/v1/locations': () => page([]),
      [`GET /api/v1/locations/${start.id}/items`]: () => page([]),
      [`POST /api/v1/locations/${start.id}/archive`]: () => {
        if (refuse) return refuse;
        current = { ...current, archivedAt, version: current.version + 1 };
        return jsonResponse(current);
      },
      [`POST /api/v1/locations/${start.id}/restore`]: () => {
        current = { ...current, archivedAt: null, version: current.version + 1 };
        return jsonResponse(current);
      },
    });
  }

  it('asks first, naming what disappears with the location, then archives with the current version', async () => {
    const calls = stateful(sub);
    renderApp(`/locations/${sub.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));

    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('Archivovat lokalitu?')).toBeInTheDocument();
    expect(dialog.getByText(/Ze seznamů zmizí také: 2 podlokality a 12 položek\./)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await userEvent.click(dialog.getByRole('button', { name: 'Archivovat' }));

    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Obnovit' })).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST')!;
    expect(new URL(post.url).pathname).toBe(`/api/v1/locations/${sub.id}/archive`);
    expect(await bodyOf(post)).toEqual({ version: sub.version });
    // Archived, it can no longer be edited or added to.
    expect(screen.queryByRole('link', { name: 'Upravit' })).not.toBeInTheDocument();
  });

  it('leaves out the warning of hidden contents for an empty location', async () => {
    const empty = location({ itemCount: 0, childCount: 0 });
    stateful(empty);
    renderApp(`/locations/${empty.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/můžete kdykoli obnovit/)).toBeInTheDocument();
    expect(dialog.queryByText(/zmizí také/)).not.toBeInTheDocument();
  });

  it('sends nothing when the dialog is cancelled', async () => {
    const calls = stateful(sub);
    renderApp(`/locations/${sub.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zrušit' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('restores an archived location at once and shows the edit button again', async () => {
    const archived = location({ archivedAt, version: 4 });
    const calls = stateful(archived);
    renderApp(`/locations/${archived.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Obnovit' }));

    expect(await screen.findByRole('link', { name: 'Upravit' })).toBeInTheDocument();
    expect(screen.queryByText('Archivováno')).not.toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST')!;
    expect(new URL(post.url).pathname).toBe(`/api/v1/locations/${archived.id}/restore`);
    expect(await bodyOf(post)).toEqual({ version: 4 });
  });

  it('shows the conflict text when somebody changed the location meanwhile', async () => {
    const conflict = { type: 'about:blank', title: 'Conflict', status: 409, code: 'conflict' };
    stateful(sub, 'write', jsonResponse(conflict, { status: 409, problem: true }));
    renderApp(`/locations/${sub.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivovat' }));
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
  });

  it('fetches the location again after a conflict, so the next try has the current version', async () => {
    const conflict = { type: 'about:blank', title: 'Conflict', status: 409, code: 'conflict' };
    const calls = stateful(sub, 'write', jsonResponse(conflict, { status: 409, problem: true }));
    renderApp(`/locations/${sub.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivovat' }));
    await screen.findByText(/Záznam mezitím někdo upravil/);
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/locations/${sub.id}`))).toHaveLength(2));
  });

  it('offers a reader neither archive nor restore', async () => {
    const archived = location({ archivedAt });
    stateful(archived, 'read');
    renderApp(`/locations/${archived.id}`);
    await screen.findByText('Archivováno');
    expect(screen.queryByRole('button', { name: /Archivovat|Obnovit/ })).not.toBeInTheDocument();
  });
});
