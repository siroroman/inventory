import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
    expect(await screen.findByText('Tuto značku zatím neservisuje žádný dodavatel.')).toBeInTheDocument();
    expect(screen.getByText(/Dodavatele ke značce přidáte v jeho formuláři/)).toBeInTheDocument();
  });

  it('keeps that hint from a reader', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => jsonResponse(manufacturerDetail({ id })) }, 'read');
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Tuto značku zatím neservisuje žádný dodavatel.')).toBeInTheDocument();
    expect(screen.queryByText(/Dodavatele ke značce přidáte/)).not.toBeInTheDocument();
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
    expect(await screen.findByRole('link', { name: 'Dodavatelé' })).toHaveAttribute('href', '/?tab=suppliers');
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
  it('offers a writer arrows, with the first up and the last down not usable', async () => {
    api();
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });

    expect(screen.getByRole('button', { name: 'Posunout nahoru: Servis Novák s.r.o.' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Posunout dolů: Servis Novák s.r.o.' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Posunout dolů: Kávoservis Plus' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Posunout nahoru: Kávoservis Plus' })).not.toHaveAttribute('aria-disabled');
  });

  it('moves a card with the arrow, shows it at once, sends the whole new order and keeps the focus on the arrow', async () => {
    let saved = false;
    const calls = api({
      [`GET /api/v1/manufacturers/${id}`]: () =>
        jsonResponse(
          manufacturerDetail({
            id,
            providers: saved
              ? [{ ...gastro, priority: 1 }, { ...novak, priority: 2 }, kavo]
              : [novak, gastro, kavo],
          }),
        ),
      [`PUT /api/v1/manufacturers/${id}/service-providers`]: () => {
        saved = true;
        return jsonResponse({ items: [{ ...gastro, priority: 1 }, { ...novak, priority: 2 }, kavo] });
      },
    });
    const user = userEvent.setup();
    renderApp(`/manufacturers/${id}`);

    const down = await screen.findByRole('button', { name: 'Posunout dolů: Servis Novák s.r.o.' });
    await user.click(down);
    await waitFor(() => expect(names()).toEqual(['GastroTech Morava', 'Servis Novák s.r.o.', 'Kávoservis Plus']));
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(await put.clone().json()).toEqual({ providerIds: [gastro.id, novak.id, kavo.id] });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Posunout dolů: Servis Novák s.r.o.' })).toHaveFocus(),
    );
    expect(await screen.findByText('Servis Novák s.r.o.: pořadí 2 z 3')).toBeInTheDocument();
    // The numbers follow the places.
    const cards = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('1');
    expect(cards[1]).toHaveTextContent('2');
  });

  it('moves a card up', async () => {
    const calls = api({
      [`PUT /api/v1/manufacturers/${id}/service-providers`]: () => jsonResponse({ items: [] }),
    });
    renderApp(`/manufacturers/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Posunout nahoru: Kávoservis Plus' }));
    const put = await waitFor(() => calls.find((call) => call.method === 'PUT')!);
    expect(await put.clone().json()).toEqual({ providerIds: [novak.id, kavo.id, gastro.id] });
  });

  it('does nothing for an arrow that cannot move the card', async () => {
    const calls = api();
    renderApp(`/manufacturers/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Posunout nahoru: Servis Novák s.r.o.' }));
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('puts the old order back and says why when saving fails', async () => {
    api({ [`PUT /api/v1/manufacturers/${id}/service-providers`]: () => problem(409, 'conflict') });
    renderApp(`/manufacturers/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Posunout dolů: Servis Novák s.r.o.' }));
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
    await waitFor(() => expect(names()).toEqual(['Servis Novák s.r.o.', 'GastroTech Morava', 'Kávoservis Plus']));
  });

  it('shows a reader no arrows', async () => {
    api({}, 'read');
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });
    expect(screen.queryByRole('button', { name: /Posunout/ })).not.toBeInTheDocument();
  });

  it('shows no arrows for an archived brand', async () => {
    api({
      [`GET /api/v1/manufacturers/${id}`]: () =>
        jsonResponse(manufacturerDetail({ id, archivedAt: '2026-05-01T00:00:00.000Z', providers: [novak, gastro] })),
    });
    renderApp(`/manufacturers/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Posunout/ })).not.toBeInTheDocument();
  });

  it('shows no arrows for a single supplier', async () => {
    api({ [`GET /api/v1/manufacturers/${id}`]: () => jsonResponse(manufacturerDetail({ id, providers: [novak] })) });
    renderApp(`/manufacturers/${id}`);
    await screen.findByRole('heading', { name: 'La Marzocco' });
    expect(screen.queryByRole('button', { name: /Posunout/ })).not.toBeInTheDocument();
  });
});
