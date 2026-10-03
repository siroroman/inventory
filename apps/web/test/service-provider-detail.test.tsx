import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { page, provider, providerDetail } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const id = '3c8e1f52-7a4b-4d69-8e0a-9b1c2d3e4f50';

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

function signedIn(current: () => Response, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/service-providers/${id}`]: current,
  });
}

describe('service provider detail', () => {
  it('shows the contact data with a phone, e-mail and web link, and the note', async () => {
    signedIn(() => jsonResponse(providerDetail({ id })));
    renderApp(`/service-providers/${id}`);

    expect(await screen.findByRole('heading', { name: 'Servis Novák s.r.o.', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('SUP-001')).toBeInTheDocument();
    expect(screen.getByText('Jan Novák')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+420 601 123 456' })).toHaveAttribute('href', 'tel:+420601123456');
    expect(screen.getByRole('link', { name: 'servis@novak-sro.cz' })).toHaveAttribute('href', 'mailto:servis@novak-sro.cz');
    const web = screen.getByRole('link', { name: 'https://www.novak-servis.cz' });
    expect(web).toHaveAttribute('href', 'https://www.novak-servis.cz');
    expect(web).toHaveAttribute('target', '_blank');
    expect(web).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('heading', { name: 'Poznámka', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Rychlá reakce, servis do 24 hodin.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět' })).toHaveAttribute('href', '/?tab=suppliers');
  });

  it('goes back to the screen it was opened from', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/service-providers': () => page([provider({ id })]),
      [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(providerDetail({ id })),
    });
    const { router } = renderApp('/?tab=suppliers');
    await userEvent.click(await screen.findByRole('link', { name: /Servis Novák s\.r\.o\./ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Zpět' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toEqual({ tab: 'suppliers' });
  });

  it('shows a dash for empty fields and leaves out the note', async () => {
    signedIn(() =>
      jsonResponse(providerDetail({ id, contactPerson: null, phone: null, email: null, web: null, note: null })),
    );
    renderApp(`/service-providers/${id}`);
    await screen.findByRole('heading', { name: 'Servis Novák s.r.o.' });
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByRole('heading', { name: 'Poznámka' })).not.toBeInTheDocument();
  });

  it('lists the brands it services with its place in each order', async () => {
    signedIn(() =>
      jsonResponse(
        providerDetail({
          id,
          manufacturers: [
            { id: crypto.randomUUID(), name: 'Daikin', archivedAt: null, priority: 3 },
            { id: crypto.randomUUID(), name: 'La Marzocco', archivedAt: '2026-05-01T00:00:00.000Z', priority: 1 },
          ],
        }),
      ),
    );
    renderApp(`/service-providers/${id}`);

    const section = (await screen.findByRole('heading', { name: 'Značky, které servisuje' })).closest('section')!;
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: 'Daikin' })).toHaveAttribute('href', expect.stringMatching(/^\/manufacturers\//));
    expect(rows[0]).toHaveTextContent('Daikin');
    expect(rows[0]).toHaveTextContent('Pořadí 3');
    expect(rows[1]).toHaveTextContent('La Marzocco');
    expect(rows[1]).toHaveTextContent('Archivováno');
  });

  it('says so when it services no brand', async () => {
    signedIn(() => jsonResponse(providerDetail({ id, manufacturers: [] })));
    renderApp(`/service-providers/${id}`);
    expect(await screen.findByText('Dodavatel zatím neservisuje žádnou značku.')).toBeInTheDocument();
  });

  it('asks first, then archives with the current version and shows the supplier archived', async () => {
    let archived = false;
    const calls = stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/service-providers/${id}`]: () =>
        jsonResponse(
          archived ? providerDetail({ id, version: 5, archivedAt: '2026-05-01T00:00:00.000Z' }) : providerDetail({ id, version: 4 }),
        ),
      [`POST /api/v1/service-providers/${id}/archive`]: () => {
        archived = true;
        return jsonResponse(providerDetail({ id, version: 5, archivedAt: '2026-05-01T00:00:00.000Z' }));
      },
    });
    renderApp(`/service-providers/${id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Archivovat dodavatele?')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Archivovat' }));
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Obnovit' })).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST')!;
    expect(await post.clone().json()).toEqual({ version: 4 });
  });

  it('restores an archived supplier with its current version, without asking', async () => {
    let restored = false;
    const calls = stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/service-providers/${id}`]: () =>
        jsonResponse(restored ? providerDetail({ id, version: 5 }) : providerDetail({ id, version: 4, archivedAt: '2026-05-01T00:00:00.000Z' })),
      [`POST /api/v1/service-providers/${id}/restore`]: () => {
        restored = true;
        return jsonResponse(providerDetail({ id, version: 5 }));
      },
    });
    renderApp(`/service-providers/${id}`);

    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Obnovit' }));
    expect(await screen.findByRole('button', { name: 'Archivovat' })).toBeInTheDocument();
    expect(screen.queryByText('Archivováno')).not.toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST')!;
    expect(await post.clone().json()).toEqual({ version: 4 });
  });

  it('shows the conflict text and stays on the supplier when somebody changed it meanwhile', async () => {
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      [`GET /api/v1/service-providers/${id}`]: () => jsonResponse(providerDetail({ id })),
      [`POST /api/v1/service-providers/${id}/archive`]: () => problem(409, 'conflict'),
    });
    renderApp(`/service-providers/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Archivovat' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivovat' }));
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Servis Novák s.r.o.', level: 1 })).toBeInTheDocument();
  });

  it('offers a reader no buttons', async () => {
    signedIn(() => jsonResponse(providerDetail({ id })), 'read');
    renderApp(`/service-providers/${id}`);
    await screen.findByRole('heading', { name: 'Servis Novák s.r.o.' });
    expect(screen.queryByRole('button', { name: /Archivovat|Obnovit/ })).not.toBeInTheDocument();
  });

  it('says the supplier does not exist on a 404, without a retry button', async () => {
    signedIn(() => problem(404, 'not_found'));
    renderApp(`/service-providers/${id}`);
    expect(await screen.findByText('Dodavatel nenalezen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    let fail = true;
    signedIn(() => {
      if (fail) return problem(500, 'internal');
      return jsonResponse(providerDetail({ id }));
    });
    renderApp(`/service-providers/${id}`);
    const retry = await screen.findByRole('button', { name: 'Zkusit znovu' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Servis Novák s.r.o.' })).toBeInTheDocument();
  });
});
