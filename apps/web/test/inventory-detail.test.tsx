import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { inventoryQueryOptions } from '../src/features/inventories/api.ts';
import { inventory, inventoryLocation, page, person, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi, stubTouchScreen } from './helpers.tsx';

const id = '5d9e2a63-8b5c-4e7a-9f1b-0a2c3d4e5f60';

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

function signedIn(current: () => Response, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/inventories/${id}`]: current,
  });
}

const roman = person('Roman Siro');
const jan = person('Jan Novák');
const petra = person('Petra Čtenářová');

describe('inventory run overview', () => {
  it('shows the root, the state, who started it and how far the run is', async () => {
    const root = ref('LOC-004', 'Sklad');
    const praha = ref('LOC-001', 'Centrála Praha');
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          location: root,
          path: [praha, root],
          startedBy: roman,
          participants: [roman, jan],
          counts: { expected: 128, checked: 84, elsewhere: 0, new: 0, missing: 0 },
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    expect(await screen.findByRole('heading', { name: 'Sklad', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Probíhá')).not.toBeInTheDocument();
    const started = screen.getByText(/^Zahájil RS · 3\. 10\. 2026 v \d{1,2}:\d{2}$/);
    expect(screen.getByText('84 / 128 zkontrolováno · 66 %')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Průběh inventury' });
    expect(bar).toHaveAttribute('aria-valuenow', '84');
    expect(bar).toHaveAttribute('aria-valuemax', '128');
    // Who started it is the last line of the box, below the progress and the figures; the box has
    // no circles of the participants (the locations name who worked in them).
    const box = started.closest('section')!;
    expect(box.lastElementChild).toBe(started.parentElement);
    expect(box.contains(bar)).toBe(true);
    expect(within(box).queryByText('Roman Siro, Jan Novák')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Zpět' })).not.toBeInTheDocument();
  });

  it('has a breadcrumb: the Inventura tab and the root as the current page, without what is above the root', async () => {
    const praha = ref('LOC-001', 'Centrála Praha');
    const root = ref('LOC-004', 'Sklad');
    signedIn(() => jsonResponse(inventory({ id, location: root, path: [praha, root] })));
    renderApp(`/inventories/${id}`);

    await screen.findByRole('heading', { name: 'Sklad', level: 1 });
    const crumbs = within(screen.getByRole('navigation', { name: 'Umístění' }));
    // Centrála Praha is above the root and has no screen in the run, so it is no crumb.
    expect(crumbs.getAllByRole('link').map((link) => link.textContent)).toEqual(['Inventura', 'Sklad']);
    // Every crumb is a link: the tab and the root (this page).
    expect(crumbs.getByRole('link', { name: 'Inventura' })).toHaveAttribute('href', '/?tab=inventory');
    const current = crumbs.getByRole('link', { name: 'Sklad' });
    expect(current).toHaveAttribute('href', `/inventories/${id}`);
    expect(current).toHaveAttribute('aria-current', 'page');
    // Only the current page is bold.
    expect(current).toHaveClass('font-bold');
    expect(crumbs.getByRole('link', { name: 'Inventura' })).not.toHaveClass('font-bold');
  });

  it('leads the Inventura crumb to the list of runs', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/inventories/${id}`]: () => jsonResponse(inventory({ id })),
      'GET /api/v1/inventories': () => jsonResponse(page([])),
    });
    renderApp(`/inventories/${id}`);
    await userEvent.click(await screen.findByRole('link', { name: 'Inventura' }));
    expect(await screen.findByRole('tab', { name: 'Inventura', selected: true })).toBeInTheDocument();
  });

  it('groups the locations by progress and keeps their order inside a group', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          counts: { expected: 14, checked: 7, elsewhere: 0, new: 0, missing: 0 },
          locations: [
            inventoryLocation({ name: 'Čistírna', total: 4, checked: 4, participants: [jan] }),
            inventoryLocation({ name: 'Dílna', total: 5, checked: 2, participants: [roman, jan] }),
            inventoryLocation({ name: 'Hala', total: 3, checked: 0 }),
            inventoryLocation({ name: 'Sklad', total: 2, checked: 1, participants: [petra] }),
            inventoryLocation({ name: 'Šatna', total: 0, checked: 0 }),
          ],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    const names = (heading: string) =>
      within((screen.getByRole('heading', { name: heading, level: 2 }).closest('section'))!)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('p')!.textContent);
    await screen.findByRole('heading', { name: 'Probíhající (2)', level: 2 });
    expect(names('Probíhající (2)')).toEqual(['Dílna', 'Sklad']);
    expect(names('Nekontrolované (2)')).toEqual(['Hala', 'Šatna']);
    expect(names('Hotovo (1)')).toEqual(['Čistírna']);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Probíhající (2)', 'Nekontrolované (2)', 'Hotovo (1)']);

    const dilna = screen.getByText('Dílna').closest('li')!;
    expect(dilna).toHaveTextContent('2 / 5 položek');
    expect(within(dilna).getByText('Roman Siro, Jan Novák')).toBeInTheDocument();
    expect(within(screen.getByText('Hala').closest('li')!).getByText(/Nikdo nezačal/)).toBeInTheDocument();
    const done = screen.getByText('Čistírna').closest('li')!;
    expect(done).toHaveTextContent('4 / 4 položek');
    expect(within(done).getByText('Hotovo')).toBeInTheDocument();
    expect(within(dilna).queryByText('Hotovo')).not.toBeInTheDocument();
  });

  it('adds the run up in four figures under the bar', async () => {
    signedIn(() =>
      jsonResponse(inventory({ id, counts: { expected: 91, checked: 3, elsewhere: 1, new: 1, missing: 0 } })),
    );
    renderApp(`/inventories/${id}`);

    // The bar is the four figures added up: 3 + 2 settled of 3 + 88 + 2.
    await screen.findByText('5 / 93 zkontrolováno · 5 %');
    const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent;
    expect(['Zkontrolováno', 'Nezkontrolováno', 'Nové', 'Chybí'].map(figure)).toEqual(['3', '88', '2', '0']);
  });

  it('reads 10 / 10 and 100 % when 7 are checked, 2 found or added and 1 flagged missing, none left', async () => {
    signedIn(() =>
      jsonResponse(inventory({ id, counts: { expected: 8, checked: 7, elsewhere: 1, new: 1, missing: 1 } })),
    );
    renderApp(`/inventories/${id}`);

    expect(await screen.findByText('10 / 10 zkontrolováno · 100 %')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Průběh inventury' });
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent;
    expect(['Zkontrolováno', 'Nezkontrolováno', 'Nové', 'Chybí'].map(figure)).toEqual(['7', '0', '2', '1']);
  });

  it('shows a run that has only finds, nothing on the list, as done', async () => {
    signedIn(() => jsonResponse(inventory({ id, counts: { expected: 0, checked: 0, elsewhere: 0, new: 2, missing: 0 } })));
    renderApp(`/inventories/${id}`);

    expect(await screen.findByText('2 / 2 zkontrolováno · 100 %')).toBeInTheDocument();
    expect(screen.queryByText('V lokalitě nejsou žádné položky.')).not.toBeInTheDocument();
  });

  it('counts the items marked missing at the finish apart from the unchecked ones', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          status: 'finished',
          endedAt: '2026-10-04T14:02:00.000Z',
          endedBy: jan,
          counts: { expected: 10, checked: 7, elsewhere: 0, new: 0, missing: 3 },
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    await screen.findByText('Dokončená');
    const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent;
    expect(['Zkontrolováno', 'Nezkontrolováno', 'Nové', 'Chybí'].map(figure)).toEqual(['7', '0', '0', '3']);
  });

  it('adds the found item to the bar but keeps the location row to the list and its finds', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          counts: { expected: 91, checked: 3, elsewhere: 1, new: 0, missing: 0 },
          locations: [inventoryLocation({ name: 'Arkády Pankrác', total: 91, checked: 3, extra: 1 })],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    expect(await screen.findByText('4 / 92 zkontrolováno · 4 %')).toBeInTheDocument();
    // The row says what the list did and names the find apart.
    expect(screen.getByText('Arkády Pankrác').closest('li')).toHaveTextContent('3 / 91 položek · 1 nová');
  });

  it('counts an item flagged as missing as dealt with: the location is done once nothing is left, and says how many are missing', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          counts: { expected: 11, checked: 5, elsewhere: 0, new: 0, missing: 3 },
          locations: [
            // Four checked and one flagged: nothing left to check.
            inventoryLocation({ name: 'Čistírna', total: 5, checked: 4, missing: 1 }),
            // Two checked, two flagged, one left.
            inventoryLocation({ name: 'Dílna', total: 5, checked: 1, missing: 2 }),
            // Nobody checked anything, but one item is flagged: work has begun.
            inventoryLocation({ name: 'Hala', total: 1, checked: 0, missing: 0 }),
          ],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Probíhající (1)', 'Nekontrolované (1)', 'Hotovo (1)']);
    const done = screen.getByText('Čistírna').closest('li')!;
    expect(done).toHaveTextContent('4 / 5 položek · 1 chybí');
    expect(within(done).getByText('Hotovo')).toBeInTheDocument();
    expect(screen.getByText('Dílna').closest('li')).toHaveTextContent('1 / 5 položek · 2 chybí');
    expect(screen.getByText('Dílna').closest('li')).not.toHaveTextContent('Hotovo');
    expect(screen.getByText('Hala').closest('li')).toHaveTextContent('Nikdo nezačal');
  });

  it('puts a location where only items are flagged missing among the ones in progress, not among the ones nobody started', async () => {
    signedIn(() =>
      jsonResponse(inventory({ id, locations: [inventoryLocation({ name: 'Sklad', total: 4, checked: 0, missing: 1 })] })),
    );
    renderApp(`/inventories/${id}`);
    const row = (await screen.findByText('Sklad')).closest('li')!;
    expect(row).toHaveTextContent('0 / 4 položek · 1 chybí');
    expect(row).not.toHaveTextContent('Nikdo nezačal');
  });

  it('puts a location that holds only found items among the ones in progress, with no 0 / 0', async () => {
    signedIn(() =>
      jsonResponse(inventory({ id, locations: [inventoryLocation({ name: 'Zasedačka', total: 0, checked: 0, extra: 2 })] })),
    );
    renderApp(`/inventories/${id}`);

    const row = (await screen.findByText('Zasedačka')).closest('li')!;
    expect(row).toHaveTextContent('2 nové');
    expect(row).not.toHaveTextContent('0 / 0');
    expect(row).not.toHaveTextContent('Nikdo nezačal');
  });

  it('links each location to its checklist', async () => {
    const root = ref('LOC-001', 'Centrála Praha');
    const self = ref('LOC-004', 'Sklad');
    const sklad = inventoryLocation({ ...self, path: [root, self], total: 3, checked: 1 });
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/inventories/${id}`]: () => jsonResponse(inventory({ id, location: root, path: [root], locations: [sklad] })),
      [`GET /api/v1/inventories/${id}/items`]: () => jsonResponse({ items: [] }),
    });
    renderApp(`/inventories/${id}`);
    const link = await screen.findByRole('link', { name: /Sklad/ });
    expect(link).toHaveAttribute('href', `/inventories/${id}/locations/${sklad.id}`);

    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Sklad', level: 1 })).toBeInTheDocument();
    // The run's root in the breadcrumb leads back to the overview.
    const crumbs = within(screen.getByRole('navigation', { name: 'Umístění' }));
    await userEvent.click(crumbs.getByRole('link', { name: 'Centrála Praha' }));
    expect(await screen.findByRole('heading', { name: 'Centrála Praha', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Sklad/ })).toBeInTheDocument();
  });

  it('links the locations of a cancelled run too, where they can be read but not ticked', async () => {
    const sklad = inventoryLocation({ name: 'Sklad', total: 3, checked: 1 });
    signedIn(() =>
      jsonResponse(
        inventory({ id, status: 'cancelled', endedAt: '2026-10-04T14:02:00.000Z', endedBy: jan, locations: [sklad] }),
      ),
    );
    renderApp(`/inventories/${id}`);
    expect(await screen.findByRole('link', { name: /Sklad/ })).toHaveAttribute(
      'href',
      `/inventories/${id}/locations/${sklad.id}`,
    );
  });

  it('writes the floor under a room that is more than one level below the root', async () => {
    const root = ref('LOC-001', 'Centrála Praha');
    const patro = ref('LOC-010', 'Patro 2');
    const room = ref('LOC-011', 'Zasedačka');
    const direct = ref('LOC-012', 'Sklad');
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          location: root,
          path: [root],
          locations: [
            inventoryLocation({ ...root, path: [root], total: 1 }),
            inventoryLocation({ ...direct, path: [root, direct], total: 1 }),
            inventoryLocation({ ...room, path: [root, patro, room], total: 1 }),
          ],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    const heading = await screen.findByRole('heading', { name: 'Nekontrolované (3)', level: 2 });
    const rows = within(heading.closest('section')!).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).queryByText(/›|Patro/)).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByText(/Patro/)).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('Patro 2')).toBeInTheDocument();
  });

  it('names who is working on it right now', async () => {
    signedIn(() => jsonResponse(inventory({ id, activeNow: [roman, jan] })));
    renderApp(`/inventories/${id}`);
    expect(await screen.findByText('RS a JN právě pracují')).toBeInTheDocument();
  });

  it('uses the singular for one person', async () => {
    signedIn(() => jsonResponse(inventory({ id, activeNow: [jan] })));
    renderApp(`/inventories/${id}`);
    expect(await screen.findByText('JN právě pracuje')).toBeInTheDocument();
  });

  describe('scanning', () => {
    it('offers Skenovat on a phone, opening the scanner for the whole run', async () => {
      stubTouchScreen();
      signedIn(() => jsonResponse(inventory({ id })));
      renderApp(`/inventories/${id}`);
      expect(await screen.findByRole('link', { name: 'Skenovat' })).toHaveAttribute('href', `/inventories/${id}/scan`);
      expect(screen.queryByText('Skenovat lze v telefonu.')).not.toBeInTheDocument();
    });

    it('says scanning is for the phone where there is no finger, and offers no link', async () => {
      signedIn(() => jsonResponse(inventory({ id })));
      renderApp(`/inventories/${id}`);
      expect(await screen.findByText('Skenovat lze v telefonu.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Skenovat' })).not.toBeInTheDocument();
    });

    it('offers nothing to a reader', async () => {
      stubTouchScreen();
      signedIn(() => jsonResponse(inventory({ id })), 'read');
      renderApp(`/inventories/${id}`);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('link', { name: 'Skenovat' })).not.toBeInTheDocument();
      expect(screen.queryByText('Skenovat lze v telefonu.')).not.toBeInTheDocument();
    });

    it('offers nothing for a run that has ended', async () => {
      stubTouchScreen();
      signedIn(() =>
        jsonResponse(inventory({ id, status: 'cancelled', endedAt: '2026-10-04T10:00:00.000Z', endedBy: roman })),
      );
      renderApp(`/inventories/${id}`);
      await screen.findByText('Zrušená');
      expect(screen.queryByRole('link', { name: 'Skenovat' })).not.toBeInTheDocument();
    });
  });

  it('says the location has no items instead of showing a bar', async () => {
    signedIn(() => jsonResponse(inventory({ id, counts: { expected: 0, checked: 0, elsewhere: 0, new: 0, missing: 0 } })));
    renderApp(`/inventories/${id}`);
    expect(await screen.findByText('V lokalitě nejsou žádné položky.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  describe('actions', () => {
    /** Presses one of the buttons under the heading. */
    async function choose(name: string) {
      await userEvent.click(await screen.findByRole('button', { name }));
    }
    const actionNames = ['Dokončit inventuru', 'Zrušit inventuru', 'Znovu otevřít inventuru', 'Archivovat', 'Obnovit'];
    /** Which of the action buttons the screen shows, in the order they are named above. */
    const offered = () =>
      actionNames.filter((name) => screen.queryByRole('button', { name }) !== null);
    const ended = { endedAt: '2026-10-03T14:02:00.000Z', endedBy: jan };

    it('shows the buttons themselves, no menu: a run in progress offers finish and cancel, nothing else', async () => {
      signedIn(() => jsonResponse(inventory({ id })));
      renderApp(`/inventories/${id}`);

      expect(await screen.findByRole('button', { name: 'Dokončit inventuru' })).toBeInTheDocument();
      expect(offered()).toEqual(['Dokončit inventuru', 'Zrušit inventuru']);
      expect(screen.queryByRole('button', { name: 'Akce inventury' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('asks first, then cancels with the current version and shows the run cancelled (phone)', async () => {
      let cancelled = false;
      const calls = stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () =>
          jsonResponse(
            cancelled
              ? inventory({ id, version: 4, status: 'cancelled', ...ended })
              : inventory({ id, version: 3 }),
          ),
        [`POST /api/v1/inventories/${id}/cancel`]: () => {
          cancelled = true;
          return jsonResponse(inventory({ id, version: 4, status: 'cancelled', ...ended }));
        },
      });
      renderApp(`/inventories/${id}`);

      await choose('Zrušit inventuru');
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Zrušit inventuru?')).toBeInTheDocument();
      expect(within(dialog).getByText(/Nic dalšího se neoznačí jako chybějící/)).toBeInTheDocument();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Zrušit inventuru' }));
      expect(await screen.findByText('Zrušená')).toBeInTheDocument();
      expect(await screen.findByText('Inventura zrušena')).toBeInTheDocument();
      const post = calls.find((call) => call.method === 'POST')!;
      expect(await post.clone().json()).toEqual({ version: 3 });
    });

    it('does not cancel when the question is dismissed', async () => {
      const calls = signedIn(() => jsonResponse(inventory({ id })));
      renderApp(`/inventories/${id}`);
      await choose('Zrušit inventuru');
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zpět' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('tells the user when somebody ended it first, and shows the run as it is now', async () => {
      let gone = false;
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () =>
          jsonResponse(gone ? inventory({ id, version: 2, status: 'cancelled', ...ended }) : inventory({ id })),
        [`POST /api/v1/inventories/${id}/cancel`]: () => {
          gone = true;
          return problem(409, 'inventory_closed');
        },
      });
      renderApp(`/inventories/${id}`);
      await choose('Zrušit inventuru');
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zrušit inventuru' }));
      expect(await screen.findByText('Inventura už je ukončená.')).toBeInTheDocument();
      expect(await screen.findByText('Zrušená')).toBeInTheDocument();
    });

    it('finishes after a question that says how many items stay not checked, and where to flag the missing ones', async () => {
      let finished = false;
      const calls = stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () =>
          jsonResponse(
            finished
              ? inventory({ id, version: 4, status: 'finished', counts: { expected: 10, checked: 7, elsewhere: 0, new: 0, missing: 0 }, ...ended })
              : inventory({ id, version: 3, counts: { expected: 10, checked: 7, elsewhere: 0, new: 0, missing: 0 } }),
          ),
        [`POST /api/v1/inventories/${id}/finish`]: () => {
          finished = true;
          return jsonResponse(inventory({ id, version: 4, status: 'finished', ...ended }));
        },
      });
      renderApp(`/inventories/${id}`);

      await choose('Dokončit inventuru');
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Dokončit inventuru?')).toBeInTheDocument();
      expect(within(dialog).getByText(/3 položky zůstanou nezkontrolované\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/Chybějící položky označíte v seznamu lokality\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/Inventura se ukončí pro všechny\./)).toBeInTheDocument();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Dokončit inventuru' }));
      expect(await screen.findByText('Dokončená')).toBeInTheDocument();
      expect(await screen.findByText('Inventura dokončena')).toBeInTheDocument();
      const post = calls.find((call) => call.method === 'POST')!;
      expect(await post.clone().json()).toEqual({ version: 3 });
    });

    it('counts the items flagged as missing apart from the ones that stay not checked', async () => {
      signedIn(() => jsonResponse(inventory({ id, counts: { expected: 10, checked: 5, elsewhere: 0, new: 0, missing: 2 } })));
      renderApp(`/inventories/${id}`);
      await choose('Dokončit inventuru');
      const text = (await screen.findByRole('alertdialog')).textContent;
      expect(text).toContain('3 položky zůstanou nezkontrolované. 2 položky jsou označené jako chybějící. Inventura se ukončí pro všechny.');
      // The flags are there already, so there is nothing to tell about where to set them.
      expect(text).not.toContain('Chybějící položky označíte');
    });

    it('says only the flagged ones when nothing else is left', async () => {
      signedIn(() => jsonResponse(inventory({ id, counts: { expected: 4, checked: 3, elsewhere: 0, new: 0, missing: 1 } })));
      renderApp(`/inventories/${id}`);
      await choose('Dokončit inventuru');
      const text = (await screen.findByRole('alertdialog')).textContent;
      expect(text).toContain('Jedna položka je označená jako chybějící. Inventura se ukončí pro všechny.');
      expect(text).not.toContain('nezkontrolovan');
    });

    it('says nothing is left to check when every item of the list is checked', async () => {
      signedIn(() => jsonResponse(inventory({ id, counts: { expected: 4, checked: 4, elsewhere: 0, new: 0, missing: 0 } })));
      renderApp(`/inventories/${id}`);
      await choose('Dokončit inventuru');
      expect(await within(await screen.findByRole('alertdialog')).findByText(/Všechny položky ze seznamu jsou zkontrolované/)).toBeInTheDocument();
    });

    it('reopens a finished run after a question and shows it in progress again', async () => {
      let reopened = false;
      const calls = stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () =>
          jsonResponse(
            reopened
              ? inventory({ id, version: 6, counts: { expected: 10, checked: 7, elsewhere: 0, new: 0, missing: 3 } })
              : inventory({
                  id,
                  version: 5,
                  status: 'finished',
                  counts: { expected: 10, checked: 7, elsewhere: 0, new: 0, missing: 3 },
                  ...ended,
                }),
          ),
        [`POST /api/v1/inventories/${id}/reopen`]: () => {
          reopened = true;
          return jsonResponse(inventory({ id, version: 6 }));
        },
      });
      renderApp(`/inventories/${id}`);
      expect(await screen.findByText('Dokončená')).toBeInTheDocument();
      expect(screen.getByText('Chybí', { selector: 'dt' }).nextElementSibling).toHaveTextContent('3');

      await choose('Znovu otevřít inventuru');
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Znovu otevřít inventuru?')).toBeInTheDocument();
      expect(within(dialog).getByText(/položky označené jako chybějící zůstanou/)).toBeInTheDocument();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Znovu otevřít inventuru' }));

      expect(await screen.findByText('Inventura znovu otevřena')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText('Dokončená')).not.toBeInTheDocument());
      // What people flagged as missing stays.
      expect(screen.getByText('Chybí', { selector: 'dt' }).nextElementSibling).toHaveTextContent('3');
      expect(await calls.find((call) => call.url.endsWith('/reopen'))!.clone().json()).toEqual({ version: 5 });
      // In progress again: finish and cancel are offered.
      await waitFor(() => expect(offered()).toEqual(['Dokončit inventuru', 'Zrušit inventuru']));
    });

    it('tells the user when another run is in progress on the location', async () => {
      stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () => jsonResponse(inventory({ id, version: 5, status: 'finished', ...ended })),
        [`POST /api/v1/inventories/${id}/reopen`]: () => problem(409, 'inventory_overlap'),
      });
      renderApp(`/inventories/${id}`);
      await choose('Znovu otevřít inventuru');
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Znovu otevřít inventuru' }));
      expect(await screen.findByText('Pro tuto lokalitu už probíhá inventura.')).toBeInTheDocument();
      expect(screen.getByText('Dokončená')).toBeInTheDocument();
    });

    it('offers to reopen a cancelled run, and to archive it', async () => {
      signedIn(() => jsonResponse(inventory({ id, status: 'cancelled', ...ended })));
      renderApp(`/inventories/${id}`);
      await screen.findByRole('button', { name: 'Znovu otevřít inventuru' });
      expect(offered()).toEqual(['Znovu otevřít inventuru', 'Archivovat']);
    });

    it('archives an ended run after a question, and restores an archived one at once', async () => {
      let archived = false;
      const calls = stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () =>
          jsonResponse(
            archived
              ? inventory({ id, version: 5, status: 'finished', archivedAt: '2026-10-05T09:00:00.000Z', ...ended })
              : inventory({ id, version: 4, status: 'finished', ...ended }),
          ),
        [`POST /api/v1/inventories/${id}/archive`]: () => {
          archived = true;
          return jsonResponse(inventory({ id, version: 5, status: 'finished', archivedAt: '2026-10-05T09:00:00.000Z', ...ended }));
        },
        [`POST /api/v1/inventories/${id}/restore`]: () => {
          archived = false;
          return jsonResponse(inventory({ id, version: 6, status: 'finished', ...ended }));
        },
      });
      renderApp(`/inventories/${id}`);

      // A finished run can be taken back or archived.
      await screen.findByRole('button', { name: 'Archivovat' });
      expect(offered()).toEqual(['Znovu otevřít inventuru', 'Archivovat']);
      await userEvent.click(screen.getByRole('button', { name: 'Archivovat' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Archivovat inventuru?')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Archivovat' }));
      expect(await screen.findByText('Archivováno')).toBeInTheDocument();
      expect(await screen.findByText('Inventura archivována')).toBeInTheDocument();
      expect(await calls.find((call) => call.url.endsWith('/archive'))!.clone().json()).toEqual({ version: 4 });

      // An archived run offers only Obnovit, which asks nothing.
      await waitFor(() => expect(offered()).toEqual(['Obnovit']));
      await choose('Obnovit');
      await waitFor(() => expect(screen.queryByText('Archivováno')).not.toBeInTheDocument());
      expect(await screen.findByText('Inventura obnovena')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(await calls.find((call) => call.url.endsWith('/restore'))!.clone().json()).toEqual({ version: 5 });
    });

    it('offers a reader no buttons at all', async () => {
      signedIn(() => jsonResponse(inventory({ id })), 'read');
      renderApp(`/inventories/${id}`);
      await screen.findByRole('heading', { name: 'Centrála Praha', level: 1 });
      expect(offered()).toEqual([]);
    });
  });

  it('shows a cancelled run read-only, with who cancelled it and when', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          status: 'cancelled',
          endedAt: '2026-10-04T14:02:00.000Z',
          endedBy: jan,
          history: [{ action: 'cancel', at: '2026-10-04T14:02:00.000Z', by: jan }],
          counts: { expected: 10, checked: 4, elsewhere: 0, new: 0, missing: 0 },
          locations: [inventoryLocation({ name: 'Sklad', total: 10, checked: 4 })],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    expect(await screen.findByText('Zrušená')).toBeInTheDocument();
    // Both lines have the form "who · date v time", the start line first.
    const lines = screen.getAllByText(/ · \d{1,2}\. \d{1,2}\. 2026 v \d{1,2}:\d{2}$/).map((line) => line.textContent);
    expect(lines).toEqual([expect.stringMatching(/^Zahájil \S+ · /), expect.stringMatching(/^Zrušil JN · 4\. 10\. 2026 v \d{1,2}:\d{2}$/)]);
    expect(screen.getByText('4 / 10 zkontrolováno · 40 %')).toBeInTheDocument();
    expect(screen.queryByText(/právě pracuj/)).not.toBeInTheDocument();
  });

  it('lists the record of a run that was cancelled and reopened, oldest first, in the same form', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          startedBy: roman,
          history: [
            { action: 'cancel', at: '2026-10-04T14:02:00.000Z', by: jan },
            { action: 'reopen', at: '2026-10-05T08:30:00.000Z', by: roman },
          ],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    const first = await screen.findByText(/^Zahájil RS/);
    expect(Array.from(first.parentElement!.children).map((line) => line.textContent)).toEqual([
      expect.stringMatching(/^Zahájil RS · 3\. 10\. 2026 v \d{1,2}:\d{2}$/),
      expect.stringMatching(/^Zrušil JN · 4\. 10\. 2026 v \d{1,2}:\d{2}$/),
      expect.stringMatching(/^Znovu otevřel RS · 5\. 10\. 2026 v \d{1,2}:\d{2}$/),
    ]);
    // The run is in progress again: no badge, no cancel in the state.
    expect(screen.queryByText('Zrušená')).not.toBeInTheDocument();
  });

  it('says who finished a run, and falls back to the date alone for an unknown person', async () => {
    signedIn(() =>
      jsonResponse(
        inventory({
          id,
          status: 'finished',
          startedBy: null,
          endedAt: '2026-10-04T14:02:00.000Z',
          history: [{ action: 'finish', at: '2026-10-04T14:02:00.000Z', by: null }],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    expect(await screen.findByText(/^Zahájeno 3\. 10\. 2026 v \d{1,2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText(/^Dokončeno 4\. 10\. 2026 v \d{1,2}:\d{2}$/)).toBeInTheDocument();
  });

  it('refreshes a run in progress every few seconds, and an ended one never', () => {
    const interval = inventoryQueryOptions(id).refetchInterval as (query: unknown) => number | false;
    const stateOf = (status: string) => ({ state: { data: { status } } });
    expect(interval(stateOf('in_progress'))).toBe(5000);
    expect(interval(stateOf('cancelled'))).toBe(false);
    expect(interval(stateOf('finished'))).toBe(false);
    expect(interval({ state: { data: undefined } })).toBe(false);
  });

  it('says the run does not exist on a 404, without a retry button', async () => {
    signedIn(() => problem(404, 'not_found'));
    renderApp(`/inventories/${id}`);
    expect(await screen.findByText('Inventura nenalezena')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    let fail = true;
    signedIn(() => (fail ? problem(500, 'internal_error') : jsonResponse(inventory({ id }))));
    renderApp(`/inventories/${id}`);
    const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Centrála Praha', level: 1 })).toBeInTheDocument();
  });
});
