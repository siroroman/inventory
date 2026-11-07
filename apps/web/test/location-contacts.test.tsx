import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { location, page, record, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const hq = ref('LOC-001', 'Centrála Praha');
const floor = ref('LOC-004', 'Přízemí');
const kitchen = ref('LOC-019', 'Teplá kuchyně');
const types = [
  { ...record, id: crypto.randomUUID(), code: 'HQ', name: 'Centrála', sortOrder: 1 },
  { ...record, id: crypto.randomUUID(), code: 'STORE', name: 'Prodejna', sortOrder: 2 },
];

const spravce = { role: 'Správce', name: 'Jan Novák', phone: '+420 601 123 456', email: 'novak@example.cz' };
const prodejna = { role: 'Prodejna', name: null, phone: '495 111 222', email: null };

type Handler = (request: Request) => Response | Promise<Response>;

/** Signed in as a writer, with the lists every location screen asks for. */
function api(routes: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role: 'write' }),
    'GET /api/v1/location-types': () => jsonResponse({ items: types }),
    'GET /api/v1/locations': () => page([]),
    ...routes,
  });
}

/** Answers the detail of `loc` and the lists under it. */
const detailOf = (loc: { id: string }) => ({
  [`GET /api/v1/locations/${loc.id}`]: () => jsonResponse(loc),
  [`GET /api/v1/locations/${loc.id}/items`]: () => page([]),
});

const bodyOf = (calls: Request[], method: string) =>
  calls.find((call) => call.method === method)?.clone().json();

/** The "Saved" toast (sonner renders the text twice: the toast and its live region). */
const savedToast = () => screen.findAllByText('Uloženo');

/** What the detail shows next to a field's label. */
const fieldValue = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement;

const contactRows = () => screen.queryAllByRole('group', { name: /^Kontakt \d+$/ });
const inRow = (index: number) => within(contactRows()[index]!);

afterEach(() => vi.restoreAllMocks());

describe('location detail: contacts', () => {
  it('lists the contacts with a call link a phone opens in its dialer, and an email link', async () => {
    const top = location({ contacts: [spravce, prodejna] });
    api(detailOf(top));
    renderApp(`/locations/${top.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Centrála Praha' })).toBeInTheDocument();
    const box = within(fieldValue('Kontakty'));
    expect(box.getByText('Správce')).toBeInTheDocument();
    expect(box.getByText('+420 601 123 456')).toBeInTheDocument();
    expect(box.getByRole('link', { name: 'Zavolat: Správce Jan Novák' })).toHaveAttribute('href', 'tel:+420601123456');
    expect(box.getByRole('link', { name: 'Napsat e-mail: Správce Jan Novák' })).toHaveAttribute(
      'href',
      'mailto:novak@example.cz',
    );
    expect(box.getByRole('link', { name: 'Zavolat: Prodejna' })).toHaveAttribute('href', 'tel:495111222');
    // A contact without an email has no email button.
    expect(box.queryByRole('link', { name: 'Napsat e-mail: Prodejna' })).not.toBeInTheDocument();
  });

  it('shows a dash when there are none, and nothing from above on a top-level location', async () => {
    const top = location();
    api(detailOf(top));
    renderApp(`/locations/${top.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Centrála Praha' })).toBeInTheDocument();
    expect(fieldValue('Kontakty')).toHaveTextContent('—');
    expect(screen.queryByText(/^Kontakty z:/)).not.toBeInTheDocument();
  });

  it('shows the contacts of the locations above, each under its name, nearest first', async () => {
    const room = location({
      id: kitchen.id,
      name: 'Teplá kuchyně',
      parentId: floor.id,
      type: null,
      path: [hq, floor, kitchen],
      inheritedContacts: [
        { location: floor, contacts: [prodejna] },
        { location: hq, contacts: [spravce] },
      ],
    });
    api(detailOf(room));
    renderApp(`/locations/${room.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Teplá kuchyně' })).toBeInTheDocument();
    expect(fieldValue('Kontakty')).toHaveTextContent('—');
    expect(screen.getAllByText(/^Kontakty z:/).map((label) => label.textContent)).toEqual([
      'Kontakty z: Přízemí',
      'Kontakty z: Centrála Praha',
    ]);
    expect(
      within(fieldValue('Kontakty z: Centrála Praha')).getByRole('link', { name: 'Zavolat: Správce Jan Novák' }),
    ).toHaveAttribute('href', 'tel:+420601123456');
  });
});

describe('location form: contacts', () => {
  /** A new top-level location the API accepts, and its detail to land on. */
  function creating() {
    const created = location({ id: crypto.randomUUID(), name: 'Prodejna Brno' });
    return api({ 'POST /api/v1/locations': () => jsonResponse(created, { status: 201 }), ...detailOf(created) });
  }

  async function startNew() {
    renderApp('/locations/new');
    await userEvent.type(await screen.findByLabelText('Název'), 'Prodejna Brno');
    await userEvent.selectOptions(await screen.findByLabelText('Typ'), 'Prodejna');
  }

  const addContact = () => userEvent.click(screen.getByRole('button', { name: 'Přidat kontakt' }));

  it('adds contacts in the order typed and leaves an empty row out', async () => {
    const calls = creating();
    await startNew();
    // No contact rows until one is added.
    expect(contactRows()).toHaveLength(0);

    await addContact();
    await userEvent.type(inRow(0).getByLabelText('Role'), 'Správce');
    await userEvent.type(inRow(0).getByLabelText('Jméno'), ' Jan Novák ');
    await userEvent.type(inRow(0).getByLabelText('Telefon'), '+420 601 123 456');
    await addContact();
    await userEvent.type(inRow(1).getByLabelText('Role'), 'Prodejna');
    await userEvent.type(inRow(1).getByLabelText('E-mail'), 'brno@example.cz');
    await addContact();
    expect(contactRows()).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await savedToast();
    expect((await bodyOf(calls, 'POST')).contacts).toEqual([
      { role: 'Správce', name: 'Jan Novák', phone: '+420 601 123 456', email: null },
      { role: 'Prodejna', name: null, phone: null, email: 'brno@example.cz' },
    ]);
  });

  it('sends no contacts for a new location without any', async () => {
    const calls = creating();
    await startNew();
    await addContact();
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await savedToast();
    expect(await bodyOf(calls, 'POST')).not.toHaveProperty('contacts');
  });

  it('names what a contact is missing or got wrong and sends nothing', async () => {
    const calls = api();
    await startNew();
    await addContact();
    await userEvent.type(inRow(0).getByLabelText('Jméno'), 'Jan Novák');
    await addContact();
    await userEvent.type(inRow(1).getByLabelText('Role'), 'Prodejna');
    await userEvent.type(inRow(1).getByLabelText('Telefon'), 'ráno');
    await userEvent.type(inRow(1).getByLabelText('E-mail'), 'brno@example');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    expect(await inRow(0).findByText('Zadejte roli, např. Správce.')).toBeInTheDocument();
    expect(inRow(0).getByText('Zadejte telefon nebo e-mail.')).toBeInTheDocument();
    expect(inRow(0).getByLabelText('Role')).toHaveAttribute('aria-invalid', 'true');
    expect(inRow(1).getByText('Zadejte platné telefonní číslo, např. +420 601 123 456.')).toBeInTheDocument();
    expect(inRow(1).getByText('Zadejte platný e-mail.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('suggests the usual roles', async () => {
    api();
    renderApp('/locations/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Přidat kontakt' }));

    const list = inRow(0).getByLabelText('Role').getAttribute('list')!;
    const options = document.getElementById(list)!.querySelectorAll('option');
    expect([...options].map((option) => option.value)).toEqual([
      'Majitel budovy',
      'Správce budovy',
      'Prodejna',
      'Vedoucí',
      'Údržba',
    ]);
  });

  describe('when editing', () => {
    const stored = [
      { role: 'Správce', name: 'Jan Novák', phone: '601 123 456', email: null },
      { role: 'Prodejna', name: null, phone: null, email: 'brno@example.cz' },
    ];
    const top = location({ id: hq.id, name: 'Centrála Praha', type: { ...types[0]! }, contacts: stored });

    const editing = (patch: Handler) => {
      const calls = api({ ...detailOf(top), [`PATCH /api/v1/locations/${hq.id}`]: patch });
      renderApp(`/locations/${hq.id}/edit`);
      return calls;
    };

    it('fills the rows, and leaves the contacts out of the request when they did not change', async () => {
      const calls = editing(() => jsonResponse({ ...top, name: 'Centrála', version: 2 }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Upravit lokalitu' })).toBeInTheDocument();
      expect(contactRows()).toHaveLength(2);
      expect(inRow(0).getByLabelText('Role')).toHaveValue('Správce');
      expect(inRow(0).getByLabelText('Telefon')).toHaveValue('601 123 456');
      expect(inRow(1).getByLabelText('E-mail')).toHaveValue('brno@example.cz');

      await userEvent.clear(screen.getByLabelText('Název'));
      await userEvent.type(screen.getByLabelText('Název'), 'Centrála');
      await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

      await savedToast();
      const body = await bodyOf(calls, 'PATCH');
      expect(body).toMatchObject({ name: 'Centrála', version: 1 });
      expect(body).not.toHaveProperty('contacts');
    });

    it('sends the whole new list when a contact is removed or changed', async () => {
      const calls = editing(() => jsonResponse({ ...top, version: 2 }));

      await screen.findByRole('heading', { level: 1, name: 'Upravit lokalitu' });
      await userEvent.click(screen.getByRole('button', { name: 'Odebrat kontakt 1' }));
      expect(contactRows()).toHaveLength(1);
      await userEvent.type(inRow(0).getByLabelText('Telefon'), '495 111 222');
      await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

      await savedToast();
      expect((await bodyOf(calls, 'PATCH')).contacts).toEqual([
        { role: 'Prodejna', name: null, phone: '495 111 222', email: 'brno@example.cz' },
      ]);
    });

    it('compares with the contacts of the reloaded copy after a conflict, not the first one', async () => {
      const theirs = [{ role: 'Majitel', name: null, phone: '777 000 111', email: null }];
      const current = { ...top, contacts: theirs, version: 2 };
      let patches = 0;
      const calls = api({
        [`GET /api/v1/locations/${hq.id}`]: () => jsonResponse(patches === 0 ? top : current),
        [`GET /api/v1/locations/${hq.id}/items`]: () => page([]),
        [`PATCH /api/v1/locations/${hq.id}`]: () => {
          patches++;
          return patches === 1
            ? jsonResponse({ type: 'about:blank', title: 'Error', status: 409, code: 'conflict' }, { status: 409, problem: true })
            : jsonResponse({ ...current, version: 3 });
        },
      });
      renderApp(`/locations/${hq.id}/edit`);

      await screen.findByRole('heading', { level: 1, name: 'Upravit lokalitu' });
      await userEvent.click(screen.getByRole('button', { name: 'Odebrat kontakt 2' }));
      await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
      const alert = await screen.findByRole('alert');
      await userEvent.click(within(alert).getByRole('button', { name: 'Načíst aktuální údaje' }));

      // The form now shows the other person's list; saving it unchanged must not send it again.
      await screen.findByDisplayValue('Majitel');
      expect(contactRows()).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
      await savedToast();
      const [, second] = calls.filter((call) => call.method === 'PATCH');
      const body = await second!.clone().json();
      expect(body).toMatchObject({ version: 2 });
      expect(body).not.toHaveProperty('contacts');
    });

    it('counts a removed contact as an unsaved change', async () => {
      editing(() => jsonResponse(top));

      await screen.findByRole('heading', { level: 1, name: 'Upravit lokalitu' });
      await userEvent.click(screen.getByRole('button', { name: 'Odebrat kontakt 2' }));
      await userEvent.click(screen.getByRole('link', { name: 'Zrušit' }));
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    });
  });
});
