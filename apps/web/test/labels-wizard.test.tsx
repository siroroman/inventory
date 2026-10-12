import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { location, page, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

const praha = location({
  id: '5f0b9d3e-5a53-4a57-8d0a-64d2a6a3c001',
  code: 'LOC-004',
  name: 'Přízemí',
  path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí')],
  itemCount: 3,
});
const brno = location({
  id: '5f0b9d3e-5a53-4a57-8d0a-64d2a6a3c002',
  code: 'LOC-002',
  name: 'Prodejna Brno',
  path: [ref('LOC-002', 'Prodejna Brno')],
  itemCount: 12,
});

const labelItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  code: `INV-${String(n).padStart(5, '0')}`,
  name: `Položka ${n}`,
  path: 'Centrála Praha › Přízemí › Kuchyně',
  ...over,
});

const inLocation = [
  labelItem(1, { name: 'Konvektomat' }),
  labelItem(2, { name: 'Myčka', path: 'Centrála Praha › Přízemí' }),
  labelItem(3, { name: 'Váha' }),
];

type Options = {
  locations?: unknown[];
  items?: unknown[];
  total?: number;
  search?: (q: string) => unknown[];
};

function api({ locations = [praha, brno], items = inLocation, total, search = () => [] }: Options = {}) {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse(me),
    'GET /api/v1/locations': () => page(locations),
    'GET /api/v1/items/labels': (request) => {
      const params = new URL(request.url).searchParams;
      if (params.get('locationId')) return jsonResponse({ items, total: total ?? items.length });
      const found = search(params.get('q') ?? '');
      return jsonResponse({ items: found, total: found.length });
    },
  });
}

const stored = (over: Record<string, unknown> = {}) =>
  sessionStorage.setItem(
    'labels-wizard',
    JSON.stringify({
      location: { id: praha.id, code: 'LOC-004', name: 'Přízemí', path: 'Centrála Praha › Přízemí', itemCount: 3 },
      excluded: [],
      added: [],
      ...over,
    }),
  );

beforeEach(() => sessionStorage.clear());

describe('labels wizard: step 1, the location', () => {
  it('lists the top-level locations with path, ID and item count, and Pokračovat waits for a choice', async () => {
    api();
    renderApp('/?tab=labels');

    expect(await screen.findByRole('heading', { name: 'Tisk štítků', level: 2 })).toBeInTheDocument();
    const results = await screen.findByRole('list', { name: 'Lokality' });
    const rows = within(results).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Přízemí');
    expect(rows[0]).toHaveTextContent('Centrála Praha');
    expect(rows[0]).toHaveTextContent('LOC-004 · 3 položky včetně podlokalit');
    expect(rows[1]).toHaveTextContent('LOC-002 · 12 položek včetně podlokalit');
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zpět' })).toBeDisabled();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Lokalita');
  });

  it('says so when the list of locations is cut off, since there is no way to page it', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/locations': () => page([praha, brno], { nextCursor: 'more', total: 35 }),
    });
    renderApp('/?tab=labels');

    expect(await screen.findByText('Zobrazeno prvních 2 z 35 lokalit. Ostatní najdete vyhledáním.')).toBeInTheDocument();
  });

  it('searches at every level with the sub-locations below each match', async () => {
    const calls = api();
    renderApp('/?tab=labels');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Hledat lokalitu podle názvu nebo ID…' }), 'kuchyn');

    await waitFor(() => {
      const search = calls.map((c) => new URL(c.url).searchParams).find((p) => p.get('q') === 'kuchyn');
      expect(search?.get('withSubLocations')).toBe('true');
    });
  });

  it('shows the chosen location as a card, keeps it in the URL and lets Pokračovat go on', async () => {
    api();
    const { router } = renderApp('/?tab=labels');

    await userEvent.click(await screen.findByRole('button', { name: /Přízemí/ }));
    expect(await screen.findByText('LOC-004 · 3 položky včetně podlokalit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Změnit' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'labels', locationId: praha.id }));

    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: 2, locationId: praha.id }));
    expect(await screen.findByRole('heading', { name: 'Vyberte položky' })).toBeInTheDocument();
  });

  it('says so when nothing matches, and offers a retry when the search fails', async () => {
    let fail = true;
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/locations': () =>
        fail
          ? jsonResponse({ type: 'about:blank', title: 'x', status: 500, code: 'internal_error' }, { status: 500, problem: true })
          : page([]),
    });
    renderApp('/?tab=labels');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByText('Nic nenalezeno')).toBeInTheDocument();
  });

  it('asks before another location replaces choices made in step 2', async () => {
    api();
    stored({ excluded: [inLocation[0]!.id] });
    renderApp(`/?tab=labels&locationId=${praha.id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));
    await userEvent.click(await screen.findByRole('button', { name: /Prodejna Brno/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Změnou lokality se výběr položek zahodí.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Zrušit' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Nothing changed: the choices are still there.
    expect(JSON.parse(sessionStorage.getItem('labels-wizard')!).excluded).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Prodejna Brno/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Změnit lokalitu' }));
    await waitFor(() => {
      const state = JSON.parse(sessionStorage.getItem('labels-wizard')!);
      expect(state.location.id).toBe(brno.id);
      expect(state.excluded).toEqual([]);
    });
  });

  it('changes the location without asking when step 2 holds no choices', async () => {
    api();
    stored();
    renderApp(`/?tab=labels&locationId=${praha.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Změnit' }));
    await userEvent.click(await screen.findByRole('button', { name: /Prodejna Brno/ }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByText('LOC-002 · 12 položek včetně podlokalit')).toBeInTheDocument();
  });

  it('starts at step 1 for a link to a later step without a remembered choice', async () => {
    api();
    const { router } = renderApp(`/?tab=labels&step=3&locationId=${praha.id}`);
    expect(await screen.findByRole('heading', { name: 'Vyberte lokalitu' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search.step).toBeUndefined());
  });
});

describe('labels wizard: step 2, the items', () => {
  const open = (extra = '') => renderApp(`/?tab=labels&step=2&locationId=${praha.id}${extra}`);

  it('lists the items of the location, all of them chosen, with where each is below the location', async () => {
    api();
    stored();
    open();

    expect(await screen.findByRole('heading', { name: 'Vyberte položky' })).toBeInTheDocument();
    expect(await screen.findByText('Vybráno 3 z 3')).toBeInTheDocument();
    // The list starts folded and renders no rows until it is opened.
    const toggle = screen.getByRole('button', { name: 'Seznam položek (3)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Položky k označení' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Položky k označení' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Konvektomat');
    expect(rows[0]).toHaveTextContent('INV-00001');
    expect(rows[0]).toHaveTextContent('Kuchyně');
    expect(rows[1]).toHaveTextContent('přímo v lokalitě');
    for (const box of within(list).getAllByRole('checkbox')) expect(box).toBeChecked();
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Položky k označení' })).not.toBeInTheDocument();
  });

  it('keeps the choices when the list is folded and opened again', async () => {
    api();
    stored();
    open();
    await screen.findByText('Vybráno 3 z 3');
    const toggle = screen.getByRole('button', { name: 'Seznam položek (3)' });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Označit Váha' }));
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(screen.getByRole('checkbox', { name: 'Označit Váha' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Označit Myčka' })).toBeChecked();
  });

  it('unchecks one item, selects none and all, and keeps the choice for a reload', async () => {
    api();
    stored();
    open();
    await screen.findByText('Vybráno 3 z 3');
    await userEvent.click(screen.getByRole('button', { name: 'Seznam položek (3)' }));

    await userEvent.click(screen.getByRole('checkbox', { name: 'Označit Váha' }));
    expect(screen.getByText('Vybráno 2 z 3')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('labels-wizard')!).excluded).toEqual([inLocation[2]!.id]);

    await userEvent.click(screen.getByRole('button', { name: 'Zrušit výběr' }));
    expect(screen.getByText('Vybráno 0 z 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Vybrat vše' }));
    expect(screen.getByText('Vybráno 3 z 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();
  });

  it('goes back to step 1 and on to step 3', async () => {
    api();
    stored();
    const { router } = open();
    await screen.findByText('Vybráno 3 z 3');

    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(3));
    await userEvent.click(await screen.findByRole('button', { name: 'Zpět' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(2));
    await userEvent.click(await screen.findByRole('button', { name: 'Zpět' }));
    await waitFor(() => expect(router.state.location.search.step).toBeUndefined());
    expect(await screen.findByText('LOC-004 · 3 položky včetně podlokalit')).toBeInTheDocument();
  });

  it('makes the numbers of the steps already set links, and only those', async () => {
    api();
    stored();
    const { router } = open();
    await screen.findByText('Vybráno 3 z 3');
    const steps = screen.getByRole('list', { name: 'Kroky' });
    // At step 2 the first step was left behind and Pokračovat is enabled, so the next number is a
    // link too; the current one and the step after the next are plain.
    expect(within(steps).getByRole('button', { name: 'Lokalita' })).toBeInTheDocument();
    expect(within(steps).queryByRole('button', { name: 'Položky' })).not.toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: 'Rozložení' })).toBeInTheDocument();
    expect(within(steps).queryByRole('button', { name: 'Stažení' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pokračovat' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(3));
    await userEvent.click(await within(steps).findByRole('button', { name: 'Lokalita' }));
    await waitFor(() => expect(router.state.location.search.step).toBeUndefined());

    // Back at step 1 the step reached stays a link, so there is a way forward without Pokračovat.
    expect(within(steps).queryByRole('button', { name: 'Lokalita' })).not.toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: 'Rozložení' })).toBeInTheDocument();
    expect(within(steps).queryByRole('button', { name: 'Stažení' })).not.toBeInTheDocument();
    await userEvent.click(within(steps).getByRole('button', { name: 'Položky' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(2));
  });

  it('makes the number of the next step a link exactly while Pokračovat is enabled', async () => {
    api();
    const { router } = renderApp('/?tab=labels');
    const steps = await screen.findByRole('list', { name: 'Kroky' });
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeDisabled();
    expect(within(steps).queryByRole('button', { name: 'Položky' })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Přízemí/ }));
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();
    expect(within(steps).queryByRole('button', { name: 'Rozložení' })).not.toBeInTheDocument();
    await userEvent.click(within(steps).getByRole('button', { name: 'Položky' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Vyberte položky' })).toBeInTheDocument();
  });

  it('shows a table with a checkbox column on a desktop screen', async () => {
    stubWideScreen(true);
    api();
    stored();
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Seznam položek (3)' }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Položky k označení',
      'Název',
      'ID',
      'Umístění',
      '',
    ]);
    expect(within(table).getAllByRole('checkbox')).toHaveLength(3);
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Označit Váha' }));
    expect(screen.getByText('Vybráno 2 z 3')).toBeInTheDocument();
  });

  it('toggles a table row by a click anywhere on it, once, without positioned overlays', async () => {
    stubWideScreen(true);
    api();
    stored();
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Seznam položek (3)' }));
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('checkbox', { name: 'Označit Váha' }).closest('tr')!;
    // Safari did not treat a table row as the containing block, so a label stretched over the row
    // by an absolutely positioned pseudo-element covered the whole page: nothing of the kind may be
    // left in the row.
    expect(row.className).not.toContain('relative');
    expect(row.querySelector('[class*="after:absolute"]')).toBeNull();

    await userEvent.click(within(row).getByText('Váha'));
    expect(screen.getByText('Vybráno 2 z 3')).toBeInTheDocument();
    await userEvent.click(within(row).getByText('INV-00003'));
    expect(screen.getByText('Vybráno 3 z 3')).toBeInTheDocument();
    // The checkbox itself and its label toggle once, not twice.
    await userEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByText('Vybráno 2 z 3')).toBeInTheDocument();
    await userEvent.click(row.querySelector('label')!);
    expect(screen.getByText('Vybráno 3 z 3')).toBeInTheDocument();
  });

  it('does not toggle a table row when the click ended a text selection', async () => {
    stubWideScreen(true);
    api();
    stored();
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Seznam položek (3)' }));
    const row = within(await screen.findByRole('table')).getByRole('checkbox', { name: 'Označit Váha' }).closest('tr')!;
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'INV-0000' } as Selection);
    await userEvent.click(within(row).getByText('Váha'));
    selection.mockRestore();
    expect(screen.getByText('Vybráno 3 z 3')).toBeInTheDocument();

    await userEvent.click(within(row).getByText('Váha'));
    expect(screen.getByText('Vybráno 2 z 3')).toBeInTheDocument();
  });

  it('explains an empty location and still offers the quick add', async () => {
    api({ items: [] });
    stored();
    open();
    expect(await screen.findByText(/V této lokalitě nejsou žádné položky/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Přidat další položky' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeDisabled();
  });

  it('shows an error with a retry when the items do not load', async () => {
    let fail = true;
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/items/labels': () =>
        fail
          ? jsonResponse({ type: 'about:blank', title: 'x', status: 500, code: 'internal_error' }, { status: 500, problem: true })
          : jsonResponse({ items: inLocation, total: 3 }),
    });
    stored();
    open();
    expect(await screen.findByText('Položky se nepodařilo načíst.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByText('Vybráno 3 z 3')).toBeInTheDocument();
  });
});

describe('labels wizard: the quick add', () => {
  const elsewhere = labelItem(50, { name: 'Notebook Dell', code: 'INV-00050', path: 'Prodejna Brno › Kancelář' });
  const another = labelItem(51, { name: 'Notebook HP', code: 'INV-00051', path: 'Prodejna Brno' });
  const search = (q: string) =>
    [elsewhere, another, ...inLocation].filter((i) => `${i.name} ${i.code}`.toLowerCase().includes(q.toLowerCase()));

  async function setup() {
    api({ search });
    stored();
    renderApp(`/?tab=labels&step=2&locationId=${praha.id}`);
    await screen.findByText('Vybráno 3 z 3');
    return screen.getByRole('combobox', { name: 'Přidat další položky' });
  }

  it('adds an item with one tap, chooses it, groups it and keeps the focus with the text selected', async () => {
    const field = await setup();
    await userEvent.type(field, 'notebook');
    const results = await screen.findByRole('listbox', { name: 'Nalezené položky' });
    expect(within(results).getAllByRole('option')).toHaveLength(2);

    await userEvent.click(within(results).getByRole('option', { name: /Notebook Dell/ }));

    expect(screen.getByText('Vybráno 4 z 4')).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect((field as HTMLInputElement).selectionStart).toBe(0);
    expect((field as HTMLInputElement).selectionEnd).toBe('notebook'.length);
    // The results stay open; the added item shows as being in the list and cannot be added twice.
    const added = within(screen.getByRole('listbox')).getByRole('option', { name: /Notebook Dell/ });
    expect(added).toHaveTextContent('Přidáno ✓');
    expect(added).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(added);
    expect(screen.getByText('Vybráno 4 z 4')).toBeInTheDocument();
    // The list shows it first, under its own heading, with its whole path and a badge.
    await userEvent.click(screen.getByRole('button', { name: 'Seznam položek (4)' }));
    expect(screen.getByText('Přidané ručně (1)')).toBeInTheDocument();
    const row = within(screen.getByRole('list', { name: 'Položky k označení' })).getAllByRole('listitem')[0]!;
    expect(row).toHaveTextContent('Notebook Dell');
    expect(row).toHaveTextContent('Prodejna Brno › Kancelář');
    expect(row).toHaveTextContent('Přidáno');
  });

  it('marks an item of the location as already in the list', async () => {
    const field = await setup();
    await userEvent.type(field, 'myčka');
    const option = await screen.findByRole('option', { name: /Myčka/ });
    expect(option).toHaveTextContent('V seznamu');
    await userEvent.click(option);
    expect(screen.getByText('Vybráno 3 z 3')).toBeInTheDocument();
  });

  it('adds the item whose ID is typed in full on Enter and reads it out', async () => {
    const field = await setup();
    await userEvent.type(field, 'inv-00051{Enter}');

    expect(await screen.findByText('Vybráno 4 z 4')).toBeInTheDocument();
    expect(screen.getByText('Přidáno: Notebook HP (INV-00051)')).toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it('adds the highlighted result with the arrow keys and Enter', async () => {
    const field = await setup();
    await userEvent.type(field, 'notebook');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(await screen.findByText('Vybráno 4 z 4')).toBeInTheDocument();
    expect(screen.getByText('Přidáno: Notebook HP (INV-00051)')).toBeInTheDocument();
  });

  it('unchecks and removes an item added by hand', async () => {
    const field = await setup();
    await userEvent.type(field, 'inv-00050{Enter}');
    await screen.findByText('Vybráno 4 z 4');

    await userEvent.click(screen.getByRole('button', { name: 'Seznam položek (4)' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Označit Notebook Dell' }));
    expect(screen.getByText('Vybráno 3 z 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat Notebook Dell' }));
    expect(screen.getByText('Vybráno 3 z 3')).toBeInTheDocument();
    expect(screen.queryByText('Přidané ručně (1)')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const field = await setup();
    await userEvent.type(field, 'nic takového');
    expect(await screen.findByText('Nic nenalezeno')).toBeInTheDocument();
  });
});

describe('labels wizard: the limit of 1 000 labels', () => {
  it('lets 1 000 through, names the rest, and stops at 1 001', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => labelItem(i + 1));
    const extra = labelItem(5000, { name: 'Navíc', code: 'INV-05000', path: 'Jinde' });
    api({ items: many, total: 1240, search: () => [extra] });
    stored();
    renderApp(`/?tab=labels&step=2&locationId=${praha.id}`);

    // Czech groups thousands with a no-break space; Testing Library compares with plain spaces.
    expect(await screen.findByText(`Vybráno 1 000 z 1 240`)).toBeInTheDocument();
    expect(screen.getByText(/Zobrazeno prvních/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();

    await userEvent.type(screen.getByRole('combobox', { name: 'Přidat další položky' }), 'inv-05000{Enter}');
    expect(
      await screen.findByText(`Vybráno 1 001 z 1 241 – nejvýše 1 000 štítků`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeDisabled();

    await act(async () => {});
    await userEvent.click(screen.getByRole('button', { name: /^Seznam položek/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Označit Navíc' }));
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();
  });
});
