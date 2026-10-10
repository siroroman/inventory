import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { inventoryItemsQueryOptions } from '../src/features/inventories/api.ts';
import { inventory, inventoryLocation, inventoryRow, person, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubTouchScreen } from './helpers.tsx';

const runId = '5d9e2a63-8b5c-4e7a-9f1b-0a2c3d4e5f60';
const root = ref('LOC-001', 'Centrála Praha');
const floor = ref('LOC-010', 'Přízemí výroba');
const kitchen = ref('LOC-019', '0.19 – Teplá kuchyně');
const roman = person('Roman Siro');
const jan = person('Jan Novák');
const checklistUrl = `/inventories/${runId}/locations/${kitchen.id}`;

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

type Row = ReturnType<typeof inventoryRow>;
type Person = ReturnType<typeof person>;
type Handler = Parameters<typeof stubApi>[0][string];

let sequence = 0;
const row = (name: string, over: Record<string, unknown> = {}): Row =>
  inventoryRow({ name, code: `INV-${String(++sequence).padStart(5, '0')}`, locationId: kitchen.id, ...over });
const done = (by: Person, at = '2026-10-03T08:42:00.000Z', method = 'scan') => ({ checkedAt: at, checkedBy: by, method });
/** Eight checked rows, a minute apart, the last of them the newest. */
const manyChecked = () =>
  Array.from({ length: 8 }, (_, n) => row(`Hotová věc ${n + 1}`, done(roman, `2026-10-03T08:0${n}:00.000Z`)));

type Options = {
  /** Where to open the checklist; by default the kitchen's. */
  url?: string;
  role?: string;
  run?: Record<string, unknown>;
  /** The numbers of the location; by default they are counted from the rows. */
  numbers?: { total: number; checked: number };
  /** Answers a tick; `apply` stores it (by Roman, or by whoever is passed) and returns the row. */
  check?: (row: Row, apply: (by?: Person) => Response) => Response | Promise<Response>;
  uncheck?: (row: Row, apply: () => Response) => Response | Promise<Response>;
  items?: Handler;
};

/** A run with one location, `kitchen`, whose rows are `rows`; the API keeps what is ticked. */
function openChecklist(rows: Row[], options: Options = {}) {
  const state = { rows: [...rows] };
  const routes: Record<string, Handler> = {
    'GET /api/v1/me': () => jsonResponse({ ...me, role: options.role ?? 'write' }),
    [`GET /api/v1/inventories/${runId}`]: () => {
      const checked = state.rows.filter((r) => r.checkedAt).length;
      const { total, checked: count } = options.numbers ?? { total: state.rows.length, checked };
      return jsonResponse(
        inventory({
          id: runId,
          location: root,
          path: [root],
          locations: [
            inventoryLocation({ ...kitchen, path: [root, floor, kitchen], total, checked: count, participants: [roman, jan] }),
          ],
          ...options.run,
        }),
      );
    },
    [`GET /api/v1/inventories/${runId}/items`]: options.items ?? (() => jsonResponse({ items: state.rows })),
  };
  const apply = (target: Row, change: Record<string, unknown>) => {
    const next = { ...target, ...change };
    const gone = next.kind !== 'expected' && !next.checkedAt;
    // An item found elsewhere drops out once unticked (the API keeps its record) and is back when ticked again.
    const present = state.rows.some((r) => r.id === target.id);
    state.rows = gone
      ? state.rows.filter((r) => r.id !== target.id)
      : present
        ? state.rows.map((r) => (r.id === target.id ? next : r))
        : [...state.rows, next];
    return jsonResponse(next);
  };
  for (const r of rows) {
    const ticked = (by: Person = roman) => apply(r, done(by, new Date().toISOString(), 'manual'));
    const cleared = () => apply(r, { checkedAt: null, checkedBy: null, method: null });
    routes[`POST /api/v1/inventories/${runId}/items/${r.id}/check`] = () => (options.check ? options.check(r, ticked) : ticked());
    routes[`POST /api/v1/inventories/${runId}/items/${r.id}/uncheck`] = () => (options.uncheck ? options.uncheck(r, cleared) : cleared());
  }
  const calls = stubApi(routes);
  return { calls, state, ...renderApp(options.url ?? checklistUrl) };
}

const posts = (calls: Request[]) => calls.filter((call) => call.method === 'POST').map((call) => new URL(call.url).pathname.split('/').slice(-3).join('/'));

/** The rows come in their own request, after the header: wait until there are some. */
const rowsLoaded = () => screen.findAllByRole('link', { name: /^Otevřít detail položky / });

/** The card with this heading ("Nezkontrolované", "Zkontrolované"). */
const group = (title: RegExp | string) => screen.getByRole('region', { name: typeof title === 'string' ? new RegExp(`^${title}`) : title });
/** The names of the items in a card, from their "open the item" links (they exist for every role). */
const names = (card: HTMLElement) =>
  within(card)
    .getAllByRole('link', { name: /^Otevřít detail položky / })
    .map((link) => link.getAttribute('aria-label')!.replace('Otevřít detail položky ', ''));

describe('inventory checklist', () => {
  it('shows the location, how far it is and who checked there, with the unchecked items first', async () => {
    openChecklist([row('Mixér tyčový'), row('Kávovar', done(roman))], { numbers: { total: 32, checked: 24 } });

    await rowsLoaded();
    expect(screen.getByRole('heading', { name: '0.19 – Teplá kuchyně', level: 1 })).toBeInTheDocument();
    // From the run's root down to the parent: the root is "Centrála Praha", the floor sits between.
    expect(screen.getByText('Centrála Praha › Přízemí výroba')).toBeInTheDocument();
    expect(screen.getByText('24 / 32 zkontrolováno · 75 %')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Průběh inventury' });
    expect(bar).toHaveAttribute('aria-valuenow', '24');
    expect(bar).toHaveAttribute('aria-valuemax', '32');
    expect(screen.getByText('Roman Siro, Jan Novák')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět' })).toHaveAttribute('href', `/inventories/${runId}`);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Nezkontrolované1', 'Zkontrolované1']);
  });

  it('starts the path at the root of the run, not at the top of the tree', async () => {
    const sklad = ref('LOC-021', 'Sklad');
    const praha = ref('LOC-002', 'Pobočka');
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/inventories/${runId}`]: () =>
        jsonResponse(
          inventory({
            id: runId,
            location: floor,
            path: [root, floor],
            locations: [inventoryLocation({ ...sklad, path: [root, praha, floor, sklad], total: 1 })],
          }),
        ),
      [`GET /api/v1/inventories/${runId}/items`]: () => jsonResponse({ items: [] }),
    });
    renderApp(`/inventories/${runId}/locations/${sklad.id}`);
    expect(await screen.findByRole('heading', { name: 'Sklad', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Přízemí výroba')).toBeInTheDocument();
    expect(screen.queryByText(/Centrála Praha/)).not.toBeInTheDocument();
  });

  it('lists the unchecked by name in Czech order and the checked with the newest first, with who and how', async () => {
    openChecklist([
      row('Žebřík hliníkový'),
      row('Čepice'),
      row('Cukřenka'),
      row('Starší', done(jan, '2026-10-03T08:10:00.000Z', 'manual')),
      row('Novější', done(roman, '2026-10-03T08:42:00.000Z', 'scan')),
    ]);
    await rowsLoaded();

    expect(names(group('Nezkontrolované'))).toEqual(['Cukřenka', 'Čepice', 'Žebřík hliníkový']);
    expect(names(group('Zkontrolované'))).toEqual(['Novější', 'Starší']);
    const checked = group('Zkontrolované');
    const newer = within(checked).getAllByRole('listitem')[0]!;
    expect(within(newer).getByText(/^RS · \d{1,2}:\d{2}$/)).toBeInTheDocument();
    expect(within(newer).getByText('sken')).toBeInTheDocument();
    const older = within(checked).getAllByRole('listitem')[1]!;
    expect(within(older).getByText(/^JN · \d{1,2}:\d{2}$/)).toBeInTheDocument();
    expect(within(older).getByText('ručně')).toBeInTheDocument();
    // An unchecked row has nothing to say about a check.
    expect(within(group('Nezkontrolované')).queryByText(/·/)).not.toBeInTheDocument();
  });

  it('shows the ID of each item and a link to its detail', async () => {
    const mixer = row('Mixér tyčový', { code: 'INV-73-2023016' });
    openChecklist([mixer]);
    expect(await screen.findByText('INV-73-2023016')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Otevřít detail položky Mixér tyčový' })).toHaveAttribute('href', `/items/${mixer.id}`);
  });

  describe('rows that were not on the list', () => {
    it('marks an item found elsewhere with where it is registered, and says when it was moved', async () => {
      const brno = ref('LOC-002', 'Centrála Brno');
      const sklad = ref('LOC-003', 'Sklad');
      openChecklist([
        row('Pokladní systém', { kind: 'elsewhere', registeredPath: [brno, sklad], ...done(roman) }),
        row('Stojan na tácy', { kind: 'elsewhere', registeredPath: [], moved: true, ...done(jan) }),
      ]);
      await rowsLoaded();

      const system = screen.getByText('Pokladní systém').closest('li')!;
      expect(within(system).getByText('Vedeno v: Centrála Brno › Sklad')).toBeInTheDocument();
      expect(within(system).getByText('Jinde')).toBeInTheDocument();
      const stand = screen.getByText('Stojan na tácy').closest('li')!;
      expect(within(stand).getByText('Vedeno v: bez lokality · přesunuto')).toBeInTheDocument();
    });

    it('shows an item found elsewhere as an ordinary check once its location was changed to this one', async () => {
      const brno = ref('LOC-002', 'Centrála Brno');
      openChecklist([
        row('Pokladní systém', { kind: 'elsewhere', registeredElsewhere: false, registeredPath: [brno], ...done(roman) }),
      ]);
      await rowsLoaded();

      const system = screen.getByText('Pokladní systém').closest('li')!;
      expect(within(system).queryByText(/Vedeno v/)).not.toBeInTheDocument();
      expect(within(system).queryByText('Jinde')).not.toBeInTheDocument();
      // A blue checkbox, like any other check: no warning colour.
      const box = within(system).getByRole('checkbox').nextElementSibling!;
      expect(box).toHaveClass('bg-primary');
      expect(box).not.toHaveClass('bg-warning');
    });

    it('marks an item added during the inventory', async () => {
      openChecklist([row('Nová police', { kind: 'new', ...done(roman) })]);
      const added = (await screen.findByText('Nová police')).closest('li')!;
      expect(within(added).getByText('přidáno při inventuře')).toBeInTheDocument();
      expect(within(added).getByText('Nové')).toBeInTheDocument();
    });
  });

  describe('the checked group', () => {
    it('lists the five newest and the rest on demand, in Czech plurals', async () => {
      openChecklist(manyChecked());
      await rowsLoaded();

      expect(names(group('Zkontrolované'))).toEqual([8, 7, 6, 5, 4].map((n) => `Hotová věc ${n}`));
      expect(screen.getByRole('heading', { name: 'Zkontrolované8' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: '… a další 3 zkontrolované' }));
      expect(names(group('Zkontrolované'))).toHaveLength(8);
      await userEvent.click(screen.getByRole('button', { name: 'Zobrazit méně' }));
      expect(names(group('Zkontrolované'))).toHaveLength(5);
    });

    it.each([
      [6, '… a další 1 zkontrolovaná'],
      [9, '… a další 4 zkontrolované'],
      [10, '… a dalších 5 zkontrolovaných'],
    ])('says "%s" rows as: %s', async (count, label) => {
      openChecklist(
        Array.from({ length: count }, (_, n) => row(`Věc ${n}`, done(roman, `2026-10-03T08:${String(n).padStart(2, '0')}:00.000Z`))),
      );
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });

    it('has no button when everything fits', async () => {
      openChecklist(manyChecked().slice(0, 5));
      await rowsLoaded();
      expect(screen.queryByRole('button', { name: /zkontrolované|zkontrolovaná|zkontrolovaných/ })).not.toBeInTheDocument();
    });
  });

  describe('search', () => {
    const rows = () => [
      row('Žebřík hliníkový', { code: 'INV-00053' }),
      row('Regál kovový A', { code: 'INV-00050' }),
      row('Regál kovový B', { code: 'INV-00051', ...done(roman) }),
    ];

    it('follows the text in the URL, ignoring case and diacritics, in name and ID', async () => {
      openChecklist(rows());
      await rowsLoaded();
      const field = screen.getByRole('searchbox', { name: 'Hledat položky v lokalitě' });

      await userEvent.type(field, 'ZEBRIK');
      await waitFor(() => expect(screen.queryByText('Regál kovový A')).not.toBeInTheDocument());
      expect(names(group('Nezkontrolované'))).toEqual(['Žebřík hliníkový']);
      expect(screen.queryByRole('region', { name: /^Zkontrolované/ })).not.toBeInTheDocument();

      await userEvent.clear(field);
      await userEvent.type(field, 'inv-00051');
      await waitFor(() => expect(screen.queryByText('Žebřík hliníkový')).not.toBeInTheDocument());
      expect(names(group('Zkontrolované'))).toEqual(['Regál kovový B']);
    });

    it('starts from the text in the URL', async () => {
      const { router } = openChecklist(rows(), { url: `${checklistUrl}?q=regal` });
      await rowsLoaded();
      expect(screen.getByRole('searchbox', { name: 'Hledat položky v lokalitě' })).toHaveValue('regal');
      expect(names(group('Nezkontrolované'))).toEqual(['Regál kovový A']);
      expect(names(group('Zkontrolované'))).toEqual(['Regál kovový B']);
      expect(router.state.location.search).toEqual({ q: 'regal' });
    });

    it('replaces the history entry as the text is typed', async () => {
      const { router } = openChecklist(rows());
      await userEvent.type(await screen.findByRole('searchbox', { name: 'Hledat položky v lokalitě' }), 'regal');
      await waitFor(() => expect(router.state.location.search).toEqual({ q: 'regal' }));
      expect(router.history.length).toBe(1);
    });

    it('says nothing was found, and lists every match instead of only the newest', async () => {
      openChecklist([...manyChecked(), row('Mixér')]);
      await rowsLoaded();
      const field = screen.getByRole('searchbox', { name: 'Hledat položky v lokalitě' });

      await userEvent.type(field, 'hotova');
      await waitFor(() => expect(names(group('Zkontrolované'))).toHaveLength(8));
      expect(screen.queryByRole('button', { name: /zkontrolované/ })).not.toBeInTheDocument();

      await userEvent.clear(field);
      await userEvent.type(field, 'nic takového');
      expect(await screen.findByText('Nic jsme nenašli')).toBeInTheDocument();
    });
  });

  describe('ticking', () => {
    it('shows the tick at once, moves the row when the server confirms it, and ignores a second tap meanwhile', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { calls } = openChecklist([row('Mixér tyčový'), row('Regál kovový A')], {
        check: async (_row, apply) => {
          await gate;
          return apply();
        },
      });
      const mixer = await screen.findByRole('checkbox', { name: 'Mixér tyčový' });
      expect(mixer).not.toBeChecked();

      await userEvent.click(mixer);

      // Pending: the box is ticked, the row is still among the unchecked ones.
      expect(mixer).toBeChecked();
      expect(mixer.closest('li')).toHaveAttribute('aria-busy', 'true');
      expect(names(group('Nezkontrolované'))).toContain('Mixér tyčový');
      // A second tap while the answer is on its way does nothing.
      await userEvent.click(mixer);
      expect(mixer).toBeChecked();

      release();
      await waitFor(() => expect(names(group('Zkontrolované'))).toEqual(['Mixér tyčový']));
      expect(names(group('Nezkontrolované'))).toEqual(['Regál kovový A']);
      expect(screen.getByRole('checkbox', { name: 'Mixér tyčový' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Mixér tyčový' }).closest('li')).toHaveAttribute('aria-busy', 'false');
      expect(posts(calls)).toHaveLength(1);
      expect(posts(calls)[0]).toMatch(/items\/[^/]+\/check$/);
      // The numbers in the header follow.
      expect(await screen.findByText('1 / 2 zkontrolováno · 50 %')).toBeInTheDocument();
    });

    it('can be done from the keyboard with Space', async () => {
      const { calls } = openChecklist([row('Mixér tyčový')]);
      const mixer = await screen.findByRole('checkbox', { name: 'Mixér tyčový' });
      mixer.focus();
      await userEvent.keyboard(' ');
      await waitFor(() => expect(names(group('Zkontrolované'))).toEqual(['Mixér tyčový']));
      expect(posts(calls)).toHaveLength(1);
    });

    it('lets a tap anywhere on the row tick it', async () => {
      const { calls } = openChecklist([row('Mixér tyčový', { code: 'INV-00046' })]);
      await userEvent.click(await screen.findByText('INV-00046'));
      await waitFor(() => expect(names(group('Zkontrolované'))).toEqual(['Mixér tyčový']));
      expect(posts(calls)).toHaveLength(1);
    });

    it('shows who checked the item first when somebody else was quicker', async () => {
      openChecklist([row('Mixér tyčový')], {
        check: (_row, apply) => apply(jan),
      });
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Mixér tyčový' }));
      const checked = await screen.findByRole('region', { name: /^Zkontrolované/ });
      expect(within(checked).getByText(/^JN · \d{1,2}:\d{2}$/)).toBeInTheDocument();
    });

    it('puts the box back and says so when the tick was not saved', async () => {
      const { calls } = openChecklist([row('Mixér tyčový')], { check: () => problem(500, 'internal_error') });
      const mixer = await screen.findByRole('checkbox', { name: 'Mixér tyčový' });

      await userEvent.click(mixer);

      expect(await screen.findByText('Zaškrtnutí se neuložilo')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Mixér tyčový' })).not.toBeChecked();
      expect(names(group('Nezkontrolované'))).toEqual(['Mixér tyčový']);
      expect(posts(calls)).toHaveLength(1);
    });

    it('gives the reason when the server refuses: the run was closed meanwhile', async () => {
      openChecklist([row('Mixér tyčový')], { check: () => problem(409, 'inventory_closed') });
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Mixér tyčový' }));
      expect(await screen.findByText('Zaškrtnutí se neuložilo')).toBeInTheDocument();
      expect(await screen.findByText('Inventura už je ukončená.')).toBeInTheDocument();
    });

    it('reports a lost connection', async () => {
      openChecklist([row('Mixér tyčový')], {
        check: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Mixér tyčový' }));
      expect(await screen.findByText('Zaškrtnutí se neuložilo')).toBeInTheDocument();
      expect(await screen.findByText(/Server není dostupný/)).toBeInTheDocument();
    });
  });

  describe('unticking', () => {
    it('returns the item to the unchecked ones and offers to undo it', async () => {
      const { calls } = openChecklist([row('Kávovar', done(roman))]);
      const box = await screen.findByRole('checkbox', { name: 'Kávovar' });
      expect(box).toBeChecked();

      await userEvent.click(box);

      expect(await screen.findByText('Kávovar: kontrola zrušena')).toBeInTheDocument();
      await waitFor(() => expect(names(group('Nezkontrolované'))).toEqual(['Kávovar']));
      expect(screen.queryByRole('region', { name: /^Zkontrolované/ })).not.toBeInTheDocument();
      expect(posts(calls)[0]).toMatch(/uncheck$/);

      await userEvent.click(screen.getByRole('button', { name: 'Vrátit' }));
      await waitFor(() => expect(names(group('Zkontrolované'))).toEqual(['Kávovar']));
      expect(posts(calls)).toHaveLength(2);
      expect(posts(calls)[1]).toMatch(/items\/[^/]+\/check$/);
    });

    it('drops an item found elsewhere out of the list, and the undo brings it back', async () => {
      const brno = ref('LOC-002', 'Centrála Brno');
      openChecklist([row('Pokladní systém', { kind: 'elsewhere', registeredPath: [brno], ...done(roman) })]);
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Pokladní systém' }));

      await waitFor(() => expect(screen.queryByText('Pokladní systém')).not.toBeInTheDocument());
      await userEvent.click(await screen.findByRole('button', { name: 'Vrátit' }));
      expect(await screen.findByText('Pokladní systém')).toBeInTheDocument();
    });
  });

  describe('who may tick', () => {
    it('shows a reader the states without checkboxes', async () => {
      openChecklist([row('Mixér tyčový'), row('Kávovar', done(roman))], { role: 'read' });
      await rowsLoaded();

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(names(group('Nezkontrolované'))).toEqual(['Mixér tyčový']);
      expect(names(group('Zkontrolované'))).toEqual(['Kávovar']);
      // They can still open the item.
      expect(screen.getAllByRole('link', { name: /^Otevřít detail položky / })).toHaveLength(2);
    });

    it('shows a writer the checkboxes, and leaves cancelling the run to the overview', async () => {
      openChecklist([row('Mixér tyčový')]);
      expect(await screen.findByRole('checkbox', { name: 'Mixér tyčový' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zrušit inventuru' })).not.toBeInTheDocument();
    });

    it('offers Skenovat to a writer on a phone, opening the scanner in this location', async () => {
      stubTouchScreen();
      openChecklist([row('Mixér tyčový')]);
      await rowsLoaded();
      expect(screen.getByRole('link', { name: 'Skenovat' })).toHaveAttribute(
        'href',
        `/inventories/${runId}/scan?locationId=${kitchen.id}`,
      );
    });

    it('offers no scanning, and no note, where there is no finger', async () => {
      openChecklist([row('Mixér tyčový')]);
      await rowsLoaded();
      expect(screen.queryByRole('link', { name: 'Skenovat' })).not.toBeInTheDocument();
      expect(screen.queryByText('Skenovat lze v telefonu.')).not.toBeInTheDocument();
    });

    it('offers no scanning to a reader on a phone', async () => {
      stubTouchScreen();
      openChecklist([row('Mixér tyčový')], { role: 'read' });
      await rowsLoaded();
      expect(screen.queryByRole('link', { name: 'Skenovat' })).not.toBeInTheDocument();
    });

    it('offers no scanning on a run that has ended', async () => {
      stubTouchScreen();
      openChecklist([row('Mixér tyčový')], {
        run: { status: 'cancelled', endedAt: '2026-10-04T14:02:00.000Z', endedBy: jan },
      });
      await rowsLoaded();
      expect(screen.queryByRole('link', { name: 'Skenovat' })).not.toBeInTheDocument();
    });

    it('shows a cancelled run read-only for everyone', async () => {
      openChecklist([row('Mixér tyčový'), row('Kávovar', done(roman))], {
        run: { status: 'cancelled', endedAt: '2026-10-04T14:02:00.000Z', endedBy: jan },
      });
      expect(await screen.findByText('Zrušená')).toBeInTheDocument();
      await rowsLoaded();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(names(group('Nezkontrolované'))).toEqual(['Mixér tyčový']);
    });

    it('stops offering the checkboxes once it turns out that somebody cancelled the run', async () => {
      let cancelled = false;
      const mixer = row('Mixér tyčový');
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${runId}`]: () =>
          jsonResponse(
            inventory({
              id: runId,
              version: cancelled ? 2 : 1,
              status: cancelled ? 'cancelled' : 'in_progress',
              endedAt: cancelled ? '2026-10-04T14:02:00.000Z' : null,
              endedBy: cancelled ? jan : null,
              locations: [inventoryLocation({ ...kitchen, path: [root, kitchen], total: 1 })],
            }),
          ),
        [`GET /api/v1/inventories/${runId}/items`]: () => jsonResponse({ items: [mixer] }),
        // Somebody cancelled the run since this screen last asked.
        [`POST /api/v1/inventories/${runId}/items/${mixer.id}/check`]: () => {
          cancelled = true;
          return problem(409, 'inventory_closed');
        },
      });
      renderApp(checklistUrl);

      await userEvent.click(await screen.findByRole('checkbox', { name: 'Mixér tyčový' }));

      expect(await screen.findByText('Inventura už je ukončená.')).toBeInTheDocument();
      expect(await screen.findByText('Zrušená')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryAllByRole('checkbox')).toHaveLength(0));
    });
  });

  describe('states', () => {
    it('shows a skeleton while loading', async () => {
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${runId}`]: () => new Promise<Response>(() => {}),
      });
      renderApp(checklistUrl);
      expect(await screen.findByRole('status', { name: 'Načítání' })).toBeInTheDocument();
    });

    it('says when everything in the location is checked', async () => {
      openChecklist([row('Kávovar', done(roman))]);
      expect(await screen.findByText('Všechny položky v této lokalitě jsou zkontrolované.')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /^Nezkontrolované/ })).not.toBeInTheDocument();
    });

    it('says the location is not part of the run, and leads back to the overview', async () => {
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${runId}`]: () => jsonResponse(inventory({ id: runId, locations: [] })),
        [`GET /api/v1/inventories/${runId}/items`]: () => jsonResponse({ items: [] }),
      });
      renderApp(checklistUrl);
      expect(await screen.findByText('Lokalita v inventuře není')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zpět na přehled inventury' })).toHaveAttribute('href', `/inventories/${runId}`);
    });

    it('says the run does not exist on a 404, without a retry button', async () => {
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${runId}`]: () => problem(404, 'not_found'),
      });
      renderApp(checklistUrl);
      expect(await screen.findByText('Inventura nenalezena')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
    });

    it('offers a retry when the rows cannot be loaded', async () => {
      let fail = true;
      openChecklist([row('Mixér tyčový')], {
        items: () => (fail ? problem(500, 'internal_error') : jsonResponse({ items: [row('Mixér tyčový')] })),
      });
      const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
      // The header is there even though the list is not.
      expect(screen.getByRole('heading', { name: '0.19 – Teplá kuchyně', level: 1 })).toBeInTheDocument();
      fail = false;
      await userEvent.click(retry);
      expect(await screen.findByRole('checkbox', { name: 'Mixér tyčový' })).toBeInTheDocument();
    });
  });

  it('fetches the rows again every few seconds while the run is in progress, and never once it ended', () => {
    expect(inventoryItemsQueryOptions(runId, kitchen.id, true).refetchInterval).toBe(5000);
    expect(inventoryItemsQueryOptions(runId, kitchen.id, false).refetchInterval).toBe(false);
  });
});
