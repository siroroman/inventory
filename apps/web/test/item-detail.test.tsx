import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, me, renderApp, stubApi, stubWideScreen } from './helpers.tsx';

const ref = (code: string, name: string) => ({ id: crypto.randomUUID(), code, name });
const id = '5b1c6d2e-3f4a-4b5c-8d9e-0a1b2c3d4e5f';
const photo = (n: number) => ({
  id: crypto.randomUUID(),
  url: `https://storage.test/photo-${n}.jpg`,
  contentType: 'image/jpeg',
  width: 800,
  height: 600,
});

function detail(over: Record<string, unknown> = {}) {
  const place = ref('LOC-019', 'Teplá kuchyně');
  return {
    id,
    version: 1,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    code: 'INV-00042',
    name: 'Konvektomat',
    model: 'SCC 101',
    serialNumber: 'SN-7781',
    manufacturer: { id: crypto.randomUUID(), name: 'Rational' },
    location: place,
    path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí'), place],
    warrantyUntil: '2020-05-01',
    lastServiceOn: '2026-03-04',
    nextServiceOn: '2000-01-01',
    manufactureYear: 2018,
    registeredOn: '2019-05-01',
    documentsUrl: 'https://drive.google.com/drive/folders/abc',
    note: 'Pravidelně odvápňovat.',
    externalIds: [{ source: 'Elektrikář', value: 'EL-4821' }],
    photos: [],
    ...over,
  };
}

const signedIn = (item: () => Response) =>
  stubApi({ 'GET /api/v1/me': () => jsonResponse(me), [`GET /api/v1/items/${id}`]: item });

describe('item detail', () => {
  it('shows every field, with badges for expired warranty and overdue service', async () => {
    signedIn(() => jsonResponse(detail()));
    renderApp(`/items/${id}`);

    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Elektrikář: EL-4821')).toBeInTheDocument();
    expect(screen.getByText('Centrála Praha › Přízemí › Teplá kuchyně')).toBeInTheDocument();
    for (const text of ['Rational', 'SCC 101', 'SN-7781', '2018', '1. 5. 2019', '1. 5. 2020', '4. 3. 2026', 'Pravidelně odvápňovat.']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('Záruka vypršela')).toBeInTheDocument();
    expect(screen.getByText('Po termínu')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Otevřít složku na Google Drive/ });
    expect(link).toHaveAttribute('href', 'https://drive.google.com/drive/folders/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows a dash for empty fields and omits the documents and note sections', async () => {
    signedIn(() =>
      jsonResponse(
        detail({
          externalIds: [],
          manufacturer: null,
          model: null,
          serialNumber: null,
          manufactureYear: null,
          registeredOn: null,
          warrantyUntil: null,
          lastServiceOn: null,
          nextServiceOn: null,
          documentsUrl: null,
          note: null,
        }),
      ),
    );
    renderApp(`/items/${id}`);
    await screen.findByRole('heading', { name: 'Konvektomat' });
    expect(screen.getAllByText('—')).toHaveLength(9);
    expect(screen.queryByText('Záruka vypršela')).not.toBeInTheDocument();
    expect(screen.queryByText('Dokumenty')).not.toBeInTheDocument();
    expect(screen.queryByText('Poznámka')).not.toBeInTheDocument();
  });

  it('marks an archived item', async () => {
    signedIn(() => jsonResponse(detail({ archivedAt: '2026-02-01T00:00:00.000Z' })));
    renderApp(`/items/${id}`);
    expect(await screen.findByText('Archivováno')).toBeInTheDocument();
  });

  it('scrolls all photos on a phone', async () => {
    signedIn(() => jsonResponse(detail({ photos: [photo(1), photo(2)] })));
    renderApp(`/items/${id}`);
    const list = await screen.findByRole('list', { name: 'Fotografie' });
    expect(within(list).getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([
      'Konvektomat, fotografie 1 z 2',
      'Konvektomat, fotografie 2 z 2',
    ]);
  });

  it('shows one large photo with thumbnails on a desktop and switches on click', async () => {
    stubWideScreen(true);
    signedIn(() => jsonResponse(detail({ photos: [photo(1), photo(2)] })));
    renderApp(`/items/${id}`);
    expect(await screen.findByRole('img', { name: 'Konvektomat, fotografie 1 z 2' })).toHaveAttribute(
      'src',
      'https://storage.test/photo-1.jpg',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zobrazit fotografii 2' }));
    expect(screen.getByRole('img', { name: 'Konvektomat, fotografie 2 z 2' })).toHaveAttribute(
      'src',
      'https://storage.test/photo-2.jpg',
    );
  });

  it('says the item does not exist on a 404, without a retry button', async () => {
    signedIn(() =>
      jsonResponse({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }, { status: 404, problem: true }),
    );
    renderApp(`/items/${id}`);
    expect(await screen.findByText('Položka nenalezena')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('shows an error with retry when the server fails, and loads again on retry', async () => {
    let calls = 0;
    signedIn(() =>
      ++calls === 1
        ? jsonResponse({ type: 'about:blank', title: 'x', status: 500, code: 'internal_error' }, { status: 500, problem: true })
        : jsonResponse(detail()),
    );
    renderApp(`/items/${id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByRole('heading', { name: 'Konvektomat' })).toBeInTheDocument();
  });

  it('is reached from the item list, and browser Back returns to the Items tab', async () => {
    const summary = { ...detail(), photos: undefined };
    stubApi({
      'GET /api/v1/me': () => jsonResponse(me),
      'GET /api/v1/items': () => jsonResponse({ items: [summary], nextCursor: null, total: 1 }),
      [`GET /api/v1/items/${id}`]: () => jsonResponse(detail()),
    });
    const { router } = renderApp('/?tab=items');
    await userEvent.click(await screen.findByRole('link', { name: /Konvektomat/ }));
    expect(await screen.findByRole('heading', { name: 'Konvektomat', level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/items/${id}`);

    router.history.back();
    expect(await screen.findByRole('tab', { name: 'Položky', selected: true })).toBeInTheDocument();
  });
});
