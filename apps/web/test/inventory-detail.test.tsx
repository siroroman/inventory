import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { inventoryQueryOptions } from '../src/features/inventories/api.ts';
import { inventory, inventoryLocation, person, ref } from './fixtures.ts';
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
    expect(screen.getByText('Centrála Praha')).toBeInTheDocument();
    expect(screen.queryByText('Probíhá')).not.toBeInTheDocument();
    expect(screen.getByText(/Inventura od 3\. 10\. 2026 · zahájil RS/)).toBeInTheDocument();
    expect(screen.getByText('84 / 128 zkontrolováno · 66 %')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Průběh inventury' });
    expect(bar).toHaveAttribute('aria-valuenow', '84');
    expect(bar).toHaveAttribute('aria-valuemax', '128');
    // The people are named for a screen reader next to their initials.
    expect(screen.getByText('Roman Siro, Jan Novák')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět' })).toHaveAttribute('href', '/?tab=inventory');
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

  it('shows the numbers of the list the same in the header and in the location', async () => {
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

    expect(await screen.findByText('3 / 91 zkontrolováno · 3 %')).toBeInTheDocument();
    // The found item is a figure of its own, not part of the list's numbers.
    expect(screen.getByText('Arkády Pankrác').closest('li')).toHaveTextContent('3 / 91 položek · 1 nová');
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
    const sklad = inventoryLocation({ name: 'Sklad', total: 3, checked: 1 });
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/inventories/${id}`]: () => jsonResponse(inventory({ id, locations: [sklad] })),
      [`GET /api/v1/inventories/${id}/items`]: () => jsonResponse({ items: [] }),
    });
    renderApp(`/inventories/${id}`);
    const link = await screen.findByRole('link', { name: /Sklad/ });
    expect(link).toHaveAttribute('href', `/inventories/${id}/locations/${sklad.id}`);

    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Sklad', level: 1 })).toBeInTheDocument();
    // Back goes to the overview it came from.
    await userEvent.click(screen.getByRole('button', { name: 'Zpět' }));
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

    const rows = await screen.findAllByRole('listitem');
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

  describe('actions menu', () => {
    /** Opens the "…" menu and chooses an entry. */
    async function choose(name: string) {
      await userEvent.click(await screen.findByRole('button', { name: 'Akce inventury' }));
      await userEvent.click(await screen.findByRole('menuitem', { name }));
    }
    const ended = { endedAt: '2026-10-03T14:02:00.000Z', endedBy: jan };

    it('replaces the cancel button: a run in progress offers finish and cancel, nothing else', async () => {
      signedIn(() => jsonResponse(inventory({ id })));
      renderApp(`/inventories/${id}`);

      expect(await screen.findByRole('button', { name: 'Akce inventury' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zrušit inventuru' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Akce inventury' }));
      expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
        'Dokončit inventuru',
        'Zrušit inventuru',
      ]);
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
      expect(within(dialog).getByText(/Nic se neoznačí jako chybějící/)).toBeInTheDocument();
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

    it('finishes after a question that says how many unchecked items become missing', async () => {
      let finished = false;
      const calls = stubApi({
        'GET /api/v1/me': () => jsonResponse(me),
        [`GET /api/v1/inventories/${id}`]: () =>
          jsonResponse(
            finished
              ? inventory({ id, version: 4, status: 'finished', counts: { expected: 10, checked: 7, elsewhere: 0, new: 0, missing: 3 }, ...ended })
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
      expect(within(dialog).getByText(/3 nezkontrolované položky se označí jako chybějící/)).toBeInTheDocument();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Dokončit inventuru' }));
      expect(await screen.findByText('Dokončená')).toBeInTheDocument();
      expect(await screen.findByText('Inventura dokončena')).toBeInTheDocument();
      const post = calls.find((call) => call.method === 'POST')!;
      expect(await post.clone().json()).toEqual({ version: 3 });
    });

    it('says nothing is left to mark missing when every item of the list is checked', async () => {
      signedIn(() => jsonResponse(inventory({ id, counts: { expected: 4, checked: 4, elsewhere: 0, new: 0, missing: 0 } })));
      renderApp(`/inventories/${id}`);
      await choose('Dokončit inventuru');
      expect(await within(await screen.findByRole('alertdialog')).findByText(/Všechny položky ze seznamu jsou zkontrolované/)).toBeInTheDocument();
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

      await userEvent.click(await screen.findByRole('button', { name: 'Akce inventury' }));
      // An ended run offers only to archive it.
      expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Archivovat']);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Archivovat' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Archivovat inventuru?')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Archivovat' }));
      expect(await screen.findByText('Archivováno')).toBeInTheDocument();
      expect(await screen.findByText('Inventura archivována')).toBeInTheDocument();
      expect(await calls.find((call) => call.url.endsWith('/archive'))!.clone().json()).toEqual({ version: 4 });

      await choose('Obnovit');
      await waitFor(() => expect(screen.queryByText('Archivováno')).not.toBeInTheDocument());
      expect(await screen.findByText('Inventura obnovena')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(await calls.find((call) => call.url.endsWith('/restore'))!.clone().json()).toEqual({ version: 5 });
    });

    it('offers a reader no menu at all', async () => {
      signedIn(() => jsonResponse(inventory({ id })), 'read');
      renderApp(`/inventories/${id}`);
      await screen.findByRole('heading', { name: 'Centrála Praha', level: 1 });
      expect(screen.queryByRole('button', { name: 'Akce inventury' })).not.toBeInTheDocument();
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
          counts: { expected: 10, checked: 4, elsewhere: 0, new: 0, missing: 0 },
          locations: [inventoryLocation({ name: 'Sklad', total: 10, checked: 4 })],
        }),
      ),
    );
    renderApp(`/inventories/${id}`);

    expect(await screen.findByText('Zrušená')).toBeInTheDocument();
    expect(screen.getByText(/Zrušil JN · 4\. 10\. 2026 v \d{1,2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText('4 / 10 zkontrolováno · 40 %')).toBeInTheDocument();
    expect(screen.queryByText(/právě pracuj/)).not.toBeInTheDocument();
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
