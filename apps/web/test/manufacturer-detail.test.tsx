import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manufacturerDetail, providerDetail, rankedProvider } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const id = 'b0000000-0000-4000-8000-000000000001';

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

const novak = rankedProvider(1, {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'Servis Novák s.r.o.',
  contactPerson: 'Jan Novák',
  phone: '+420 601 123 456',
  email: 'servis@novak-sro.cz',
  web: 'https://www.novak-servis.cz',
});
const gastro = rankedProvider(2, { id: 'c0000000-0000-4000-8000-000000000002', name: 'GastroTech Morava' });
const kavo = rankedProvider(3, { id: 'c0000000-0000-4000-8000-000000000003', name: 'Kávoservis Plus' });

function api(routes: Parameters<typeof stubApi>[0] = {}, role = 'write') {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/manufacturers/${id}`]: () =>
      jsonResponse(manufacturerDetail({ id, providers: [novak, gastro, kavo] })),
    ...routes,
  });
}

const names = () => within(screen.getByRole('list')).getAllByRole('listitem').map((li) => within(li).getAllByRole('link')[0]!.textContent);

describe('manufacturer detail', () => {
  it('shows the name, the note and the suppliers in contact order with what is known of each', async () => {
    api();
    renderApp(`/manufacturers/${id}`);

    expect(await screen.findByRole('heading', { name: 'La Marzocco', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Italský výrobce profesionálních kávovarů.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Servis zajišťují', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Kontaktujte dodavatele v tomto pořadí/)).toBeInTheDocument();
    expect(names()).toEqual(['Servis Novák s.r.o.', 'GastroTech Morava', 'Kávoservis Plus']);

    const [first, second] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(first).toHaveTextContent('1');
    expect(first).toHaveTextContent('Jan Novák · +420 601 123 456');
    expect(within(first!).getByRole('link', { name: 'Servis Novák s.r.o.' })).toHaveAttribute('href', `/service-providers/${novak.id}`);
    expect(within(first!).getByRole('link', { name: 'Zavolat: Servis Novák s.r.o.' })).toHaveAttribute('href', 'tel:+420601123456');
    expect(within(first!).getByRole('link', { name: 'Napsat e-mail: Servis Novák s.r.o.' })).toHaveAttribute('href', 'mailto:servis@novak-sro.cz');
    const web = within(first!).getByRole('link', { name: 'Otevřít web: Servis Novák s.r.o.' });
    expect(web).toHaveAttribute('href', 'https://www.novak-servis.cz');
    expect(web).toHaveAttribute('target', '_blank');
    // A supplier without contact data shows a dash and no action buttons.
    expect(second).toHaveTextContent('—');
    expect(within(second!).getAllByRole('link')).toHaveLength(1);
  });

  it('marks an archived supplier that is still in the order', async () => {
    api({
      [`GET /api/v1/manufacturers/${id}`]: () =>
        jsonResponse(manufacturerDetail({ id, providers: [{ ...novak, archivedAt: '2026-05-01T00:00:00.000Z' }] })),
    });
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
  });

  it('says no supplier services the brand, and tells a writer where to add one', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => jsonResponse(manufacturerDetail({ id })) });
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Tohoto výrobce zatím neservisuje žádný dodavatel.')).toBeInTheDocument();
    expect(screen.getByText(/Dodavatele k výrobci přidáte ve formuláři dodavatele/)).toBeInTheDocument();
  });

  it('keeps that hint from a reader', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => jsonResponse(manufacturerDetail({ id })) }, 'read');
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Tohoto výrobce zatím neservisuje žádný dodavatel.')).toBeInTheDocument();
    expect(screen.queryByText(/Dodavatele k výrobci přidáte/)).not.toBeInTheDocument();
  });

  it('leaves out the note section when there is no note', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => jsonResponse(manufacturerDetail({ id, note: null, providers: [novak] })) });
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });
    expect(screen.queryByRole('heading', { name: 'Poznámka' })).not.toBeInTheDocument();
  });

  it('says the brand does not exist on a 404, without a retry button', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => problem(404, 'not_found') });
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Výrobce nenalezen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('leads back to the suppliers list on a deep link', async () => {
    api();
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByRole('link', { name: 'Zpět' })).toHaveAttribute('href', '/?tab=suppliers');
  });

  it('goes back to where the user came from', async () => {
    const supplierId = '3c8e1f52-7a4b-4d69-8e0a-9b1c2d3e4f50';
    api({
      [`GET /api/v1/service-providers/${supplierId}`]: () =>
        jsonResponse(providerDetail({ id: supplierId, manufacturers: [{ id, name: 'La Marzocco', archivedAt: null, priority: 1 }] })),
    });
    const { router } = renderApp(`/service-providers/${supplierId}`);
    await userEvent.click(await screen.findByRole('link', { name: 'La Marzocco' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Zpět' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/service-providers/${supplierId}`));
  });
});

describe('manufacturer detail: contact order', () => {
  // jsdom lays nothing out: give each card its place, one under another, so a drag can measure them.
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const card = this.closest('li');
      const top = card?.parentElement ? [...card.parentElement.children].indexOf(card) * 100 : 0;
      return { x: 0, y: top, top, left: 0, right: 400, bottom: top + 80, width: 400, height: 80, toJSON: () => ({}) };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const handle = (name: string) => screen.getByRole('button', { name: `Přesunout: ${name}` });

  /** The order the API answers with once a PUT has saved one. */
  function savingApi(answer: (ids: string[]) => Response = () => jsonResponse({ items: [] })) {
    let order = [novak, gastro, kavo];
    const calls = api({
      [`GET /api/v1/manufacturers/${id}`]: () =>
        jsonResponse(manufacturerDetail({ id, providers: order.map((p, i) => ({ ...p, priority: i + 1 })) })),
      [`PUT /api/v1/manufacturers/${id}/service-providers`]: async (request) => {
        const { providerIds } = (await request.clone().json()) as { providerIds: string[] };
        const response = answer(providerIds);
        if (response.ok) order = providerIds.map((pid) => [novak, gastro, kavo].find((p) => p.id === pid)!);
        return response;
      },
    });
    return calls;
  }

  const putBody = async (calls: Request[]) => {
    const put = await waitFor(() => {
      const found = calls.find((call) => call.method === 'PUT');
      expect(found).toBeDefined();
      return found!;
    });
    return put.clone().json();
  };

  it('offers a writer a drag handle on every card, in one column, without arrows', async () => {
    api();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    for (const p of [novak, gastro, kavo]) expect(handle(p.name)).toBeInTheDocument();
    expect(handle(novak.name)).toHaveAccessibleDescription(/mezerníkem zvednete, šipkami nahoru a dolů posunete/);
    expect(screen.queryByRole('button', { name: /Posunout/ })).not.toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveClass('lg:grid-cols-3');
  });

  it('moves a card with the keyboard, shows it at once, sends the whole new order and keeps the focus', async () => {
    const calls = savingApi();
    const user = userEvent.setup();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    handle(novak.name).focus();
    await user.keyboard('[Space]');
    expect(await screen.findByText('Zvednuto: Servis Novák s.r.o., pořadí 1 z 3')).toBeInTheDocument();
    await user.keyboard('[ArrowDown]');
    expect(await screen.findByText('Servis Novák s.r.o.: pořadí 2 z 3')).toBeInTheDocument();
    await user.keyboard('[Space]');

    await waitFor(() => expect(names()).toEqual(['GastroTech Morava', 'Servis Novák s.r.o.', 'Kávoservis Plus']));
    expect(await putBody(calls)).toEqual({ providerIds: [gastro.id, novak.id, kavo.id] });
    await waitFor(() => expect(handle(novak.name)).toHaveFocus());
    // The numbers follow the places.
    const cards = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('1');
    expect(cards[1]).toHaveTextContent('2');
  });

  it('moves a card up with the keyboard', async () => {
    const calls = savingApi();
    const user = userEvent.setup();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    handle(kavo.name).focus();
    await user.keyboard('[Space]');
    await screen.findByText('Zvednuto: Kávoservis Plus, pořadí 3 z 3');
    await user.keyboard('[ArrowUp]');
    await screen.findByText('Kávoservis Plus: pořadí 2 z 3');
    await user.keyboard('[Space]');
    expect(await putBody(calls)).toEqual({ providerIds: [novak.id, kavo.id, gastro.id] });
  });

  it('moves a card dragged with the pointer', async () => {
    const calls = savingApi();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    // Novák's card (0-80 px) dragged by 110 px lands on GastroTech's place (100-180 px).
    fireEvent.pointerDown(handle(novak.name), { isPrimary: true, button: 0, clientX: 20, clientY: 40 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 50 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 150 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 150 });

    await waitFor(() => expect(names()).toEqual(['GastroTech Morava', 'Servis Novák s.r.o.', 'Kávoservis Plus']));
    expect(await putBody(calls)).toEqual({ providerIds: [gastro.id, novak.id, kavo.id] });
  });

  it('saves nothing when the drag is cancelled or the card is dropped where it was', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    handle(novak.name).focus();
    await user.keyboard('[Space]');
    await screen.findByText(/^Zvednuto/);
    await user.keyboard('[ArrowDown]');
    await screen.findByText('Servis Novák s.r.o.: pořadí 2 z 3');
    await user.keyboard('[Escape]');
    expect(await screen.findByText('Přesun zrušen: Servis Novák s.r.o. zůstává na pořadí 1 z 3')).toBeInTheDocument();

    await user.keyboard('[Space]');
    await screen.findByText(/^Zvednuto/);
    await user.keyboard('[ArrowUp]');
    await user.keyboard('[Space]');
    expect(names()).toEqual(['Servis Novák s.r.o.', 'GastroTech Morava', 'Kávoservis Plus']);
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('puts the old order back and says why when saving fails', async () => {
    savingApi(() => problem(409, 'conflict'));
    const user = userEvent.setup();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    handle(novak.name).focus();
    await user.keyboard('[Space]');
    await screen.findByText(/^Zvednuto/);
    await user.keyboard('[ArrowDown]');
    await screen.findByText('Servis Novák s.r.o.: pořadí 2 z 3');
    await user.keyboard('[Space]');
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
    await waitFor(() => expect(names()).toEqual(['Servis Novák s.r.o.', 'GastroTech Morava', 'Kávoservis Plus']));
  });

  it('shows a reader no handles', async () => {
    api({}, 'read');
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });
    expect(screen.queryByRole('button', { name: /Přesunout/ })).not.toBeInTheDocument();
  });

  it('shows no handles for an archived brand', async () => {
    api({
      [`GET /api/v1/manufacturers/${id}`]: () =>
        jsonResponse(manufacturerDetail({ id, archivedAt: '2026-05-01T00:00:00.000Z', providers: [novak, gastro] })),
    });
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Přesunout/ })).not.toBeInTheDocument();
  });

  it('shows no handle for a single supplier', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => jsonResponse(manufacturerDetail({ id, providers: [novak] })) });
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });
    expect(screen.queryByRole('button', { name: /Přesunout/ })).not.toBeInTheDocument();
  });
});
