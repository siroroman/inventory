import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { inventory, location, page, person, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  jsonResponse({ type: 'about:blank', title: code, status, code, ...extra }, { status, problem: true });

const praha = ref('LOC-001', 'Centrála Praha');
const sklad = ref('LOC-004', 'Sklad');
const locations = [
  location({ ...praha, path: [praha], parentId: null }),
  location({ ...sklad, path: [praha, sklad], parentId: praha.id }),
];

const clear = { itemCount: 128, locationCount: 6, overlap: null };

function api(over: Record<string, (request: Request) => Response | Promise<Response>> = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    'GET /api/v1/locations': () => page(locations),
    'GET /api/v1/inventories/preview': () => jsonResponse(clear),
    ...over,
  });
}

async function choose(name: string | RegExp) {
  await userEvent.click(await screen.findByPlaceholderText('Hledat lokalitu podle názvu nebo ID'));
  const results = await screen.findByRole('list', { name: /Výsledky/ });
  await userEvent.click(within(results).getByRole('button', { name }));
}

describe('start an inventory', () => {
  it('searches locations at every level and tells equal names apart by ID and path', async () => {
    const calls = api();
    renderApp('/inventories/new');
    await userEvent.click(await screen.findByPlaceholderText('Hledat lokalitu podle názvu nebo ID'));

    const results = await screen.findByRole('list', { name: /Výsledky/ });
    const rows = within(results).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Centrála PrahaLOC-001');
    expect(rows[1]).toHaveTextContent('SkladLOC-004 · Centrála Praha');
    const query = new URL(calls.find((c) => new URL(c.url).pathname === '/api/v1/locations')!.url).searchParams;
    expect(query.get('limit')).toBe('20');
  });

  it('keeps the start button off until a location is chosen, then says what will be checked', async () => {
    const calls = api();
    renderApp('/inventories/new');
    const start = await screen.findByRole('button', { name: 'Zahájit inventuru' });
    expect(start).toBeDisabled();
    expect(calls.some((c) => new URL(c.url).pathname === '/api/v1/inventories/preview')).toBe(false);

    await choose(/Sklad/);

    expect(await screen.findByText('Zkontroluje se 128 položek v 6 lokalitách.')).toBeInTheDocument();
    expect(start).toBeEnabled();
    const preview = calls.find((c) => new URL(c.url).pathname === '/api/v1/inventories/preview')!;
    expect(new URL(preview.url).searchParams.get('locationId')).toBe(locations[1]!.id);
  });

  it.each([
    [{ itemCount: 1, locationCount: 1 }, 'Zkontroluje se 1 položka v 1 lokalitě.'],
    [{ itemCount: 3, locationCount: 2 }, 'Zkontrolují se 3 položky v 2 lokalitách.'],
    [{ itemCount: 22, locationCount: 5 }, 'Zkontroluje se 22 položek v 5 lokalitách.'],
  ])('uses the right Czech forms for %o', async (counts, sentence) => {
    api({ 'GET /api/v1/inventories/preview': () => jsonResponse({ ...counts, overlap: null }) });
    renderApp('/inventories/new');
    await choose(/Sklad/);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });

  it('allows a location without items and says so', async () => {
    api({ 'GET /api/v1/inventories/preview': () => jsonResponse({ itemCount: 0, locationCount: 0, overlap: null }) });
    renderApp('/inventories/new');
    await choose(/Sklad/);
    expect(await screen.findByText('V lokalitě nejsou žádné položky.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zahájit inventuru' })).toBeEnabled();
  });

  it('warns about a run in progress that overlaps, offers to open it and does not allow the start', async () => {
    const running = crypto.randomUUID();
    api({
      'GET /api/v1/inventories/preview': () =>
        jsonResponse({
          ...clear,
          overlap: { id: running, location: praha, startedBy: person('Roman Siro'), startedAt: '2026-10-03T07:15:00.000Z' },
        }),
    });
    renderApp('/inventories/new');
    await choose(/Sklad/);

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Pro tuto lokalitu už probíhá inventura: Centrála Praha, zahájil RS 3. 10. 2026');
    expect(within(warning).getByRole('link', { name: 'Otevřít' })).toHaveAttribute('href', `/inventories/${running}`);
    expect(screen.getByRole('button', { name: 'Zahájit inventuru' })).toBeDisabled();
  });

  it('starts the run for the chosen location and opens its overview', async () => {
    const run = inventory({ location: sklad, path: [praha, sklad] });
    const calls = api({
      'POST /api/v1/inventories': () => jsonResponse(run, { status: 201 }),
      [`GET /api/v1/inventories/${run.id}`]: () => jsonResponse(run),
    });
    const { router } = renderApp('/inventories/new');
    await choose(/Sklad/);
    await screen.findByText('Zkontroluje se 128 položek v 6 lokalitách.');
    await userEvent.click(screen.getByRole('button', { name: 'Zahájit inventuru' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/inventories/${run.id}`));
    expect(await screen.findByRole('heading', { name: 'Sklad', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Inventura zahájena')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(await post.clone().json()).toEqual({ locationId: locations[1]!.id });
  });

  it('shows the Czech text and the warning when somebody started a run in the meantime', async () => {
    const running = crypto.randomUUID();
    let taken = false;
    api({
      'GET /api/v1/inventories/preview': () =>
        jsonResponse(
          taken
            ? { ...clear, overlap: { id: running, location: praha, startedBy: person('Jan Novák'), startedAt: '2026-10-03T07:15:00.000Z' } }
            : clear,
        ),
      'POST /api/v1/inventories': () => {
        taken = true;
        return problem(409, 'inventory_overlap');
      },
    });
    renderApp('/inventories/new');
    await choose(/Sklad/);
    await screen.findByText('Zkontroluje se 128 položek v 6 lokalitách.');
    await userEvent.click(screen.getByRole('button', { name: 'Zahájit inventuru' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent === 'Pro tuto lokalitu už probíhá inventura.')).toBe(true);
    expect(await screen.findByText(/zahájil JN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zahájit inventuru' })).toBeDisabled();
  });

  it('offers a retry when the preview fails', async () => {
    let fail = true;
    api({ 'GET /api/v1/inventories/preview': () => (fail ? problem(500, 'internal_error') : jsonResponse(clear)) });
    renderApp('/inventories/new');
    await choose(/Sklad/);
    const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
    expect(screen.getByRole('button', { name: 'Zahájit inventuru' })).toBeDisabled();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Zkontroluje se 128 položek v 6 lokalitách.')).toBeInTheDocument();
  });

  it('goes back without starting anything', async () => {
    const calls = api();
    const { router } = renderApp('/inventories/new');
    await userEvent.click(await screen.findByRole('link', { name: 'Zrušit' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toEqual({ tab: 'inventory' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('is not for readers', async () => {
    const calls = api({}, 'read');
    renderApp('/inventories/new');
    expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zahájit inventuru' })).not.toBeInTheDocument();
    expect(calls.some((c) => new URL(c.url).pathname === '/api/v1/locations')).toBe(false);
  });
});
