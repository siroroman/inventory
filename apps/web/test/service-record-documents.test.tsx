import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, me, renderApp, stubApi, stubTouchScreen } from './helpers.tsx';

// jsdom cannot decode or draw images; the real resizing is checked in a browser.
vi.mock('../src/lib/resize-image.ts', () => ({
  resizeImage: async () => new Blob([new Uint8Array(4321)], { type: 'image/jpeg' }),
}));

const id = '7a2d9e41-5c3b-4e8f-9a60-1b2c3d4e5f60';
const itemId = '5b1c6d2e-3f4a-4b5c-8d9e-0a1b2c3d4e5f';
const documentsUrl = `/api/v1/service-records/${id}/documents`;
const PDF = 'application/pdf';

const record = (over: Record<string, unknown> = {}, itemOver: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  archivedAt: null,
  createdAt: '2026-04-15T08:00:00.000Z',
  updatedAt: '2026-04-15T08:00:00.000Z',
  performedOn: '2026-04-15',
  title: 'Výměna filtru',
  performedBy: null,
  responsiblePerson: null,
  description: null,
  item: { id: itemId, code: 'INV-00042', name: 'Kávovar Linea PB', archivedAt: null, ...itemOver },
  ...over,
});

const documentDto = (over: Record<string, unknown> = {}) => ({
  id: '9d3a1b6c-2e4f-4a7b-8c1d-5e6f7a8b9c01',
  version: 1,
  name: 'Servisní protokol',
  contentType: PDF,
  size: 122_880,
  url: 'https://storage.test/service-records/x/a.pdf?sig=1',
  downloadUrl: 'https://storage.test/service-records/x/a.pdf?sig=1&download=1',
  createdAt: '2026-10-02T12:00:00.000Z',
  createdBy: { id: me.id, name: 'Jana Nováková' },
  ...over,
});

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

type Routes = Parameters<typeof stubApi>[0];
function open(routes: Routes = {}, { role = 'write', rec = record() }: { role?: string; rec?: ReturnType<typeof record> } = {}) {
  const calls = stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role }),
    [`GET /api/v1/service-records/${id}`]: () => jsonResponse(rec),
    [`GET ${documentsUrl}`]: () => jsonResponse([]),
    ...routes,
  });
  renderApp(`/service-records/${id}`);
  return calls;
}

const fileInput = (kind: 'file' | 'camera' = 'file') =>
  document.querySelector<HTMLInputElement>(`[data-slot="document-${kind}-input"]`)!;

const pdf = (name = 'protokol.pdf', size = 1000) => new File([new Uint8Array(size)], name, { type: PDF });

describe('documents of a service record: list', () => {
  it('shows each document with name, date, author and size, newest first', async () => {
    open({
      [`GET ${documentsUrl}`]: () =>
        jsonResponse([
          documentDto(),
          documentDto({ id: 'a1', name: 'Faktura', contentType: 'image/jpeg', size: 2_621_440, createdBy: null, url: 'https://storage.test/b.jpg' }),
        ]),
    });
    expect(await screen.findByRole('heading', { name: 'Dokumenty (2)' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Servisní protokol' });
    expect(link).toHaveAttribute('href', 'https://storage.test/service-records/x/a.pdf?sig=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText('Přidáno 2. 10. 2026 · Jana Nováková · 120 kB')).toBeInTheDocument();
    expect(screen.getByText('Přidáno 2. 10. 2026 · 2,5 MB')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^(Servisní protokol|Faktura)$/ }).map((a) => a.textContent)).toEqual(['Servisní protokol', 'Faktura']);
  });

  it('shows an empty state', async () => {
    open();
    expect(await screen.findByText('Zatím žádné dokumenty')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dokumenty (0)' })).toBeInTheDocument();
  });

  it('shows a retry when the list cannot be loaded', async () => {
    let fail = true;
    open({ [`GET ${documentsUrl}`]: () => (fail ? problem(500, 'internal_error') : jsonResponse([documentDto()])) });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Něco se nepovedlo. Zkuste to prosím znovu.')).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByRole('link', { name: 'Servisní protokol' })).toBeInTheDocument();
  });

  it('gives a reader the list but no way to change it', async () => {
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]) }, { role: 'read' });
    expect(await screen.findByRole('link', { name: 'Servisní protokol' })).toBeInTheDocument();
    for (const name of [/Nahrát soubor/, /Vyfotit/, /Přejmenovat/, /Smazat/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('keeps the documents of an archived record or of an archived item read-only', async () => {
    const list = { [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]) };
    open(list, { rec: record({ archivedAt: '2026-05-01T00:00:00.000Z' }) });
    expect(await screen.findByRole('link', { name: 'Servisní protokol' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nahrát soubor|Smazat/ })).not.toBeInTheDocument();
  });

  it('keeps the documents of an archived item read-only', async () => {
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]) }, { rec: record({}, { archivedAt: '2026-05-01T00:00:00.000Z' }) });
    expect(await screen.findByRole('link', { name: 'Servisní protokol' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nahrát soubor|Smazat/ })).not.toBeInTheDocument();
  });
});

describe('documents of a service record: view and download', () => {
  const pdfUrl = 'https://storage.test/service-records/x/a.pdf?sig=1';

  it('offers a download for every document, also to a reader and under an archived record', async () => {
    const docx = documentDto({ id: 'd2', name: 'Zpráva', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', downloadUrl: 'https://storage.test/z.docx?download=1' });
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto(), docx]) }, { role: 'read', rec: record({ archivedAt: '2026-05-01T00:00:00.000Z' }) });
    const pdfLink = await screen.findByRole('link', { name: 'Stáhnout Servisní protokol' });
    expect(pdfLink).toHaveAttribute('href', `${pdfUrl}&download=1`);
    expect(pdfLink).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Stáhnout Zpráva' })).toHaveAttribute('href', 'https://storage.test/z.docx?download=1');
  });

  it('shows a PDF in a viewer with the document name and a download, and closes it', async () => {
    const user = userEvent.setup();
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]) }, { role: 'read' });
    await user.click(await screen.findByRole('button', { name: 'Zobrazit Servisní protokol' }));

    const dialog = await screen.findByRole('dialog', { name: 'Servisní protokol' });
    expect(within(dialog).getByTitle('Servisní protokol')).toHaveAttribute('src', pdfUrl);
    expect(within(dialog).getByRole('link', { name: 'Stáhnout Servisní protokol' })).toHaveAttribute('href', `${pdfUrl}&download=1`);
    await user.click(within(dialog).getByRole('button', { name: 'Zavřít' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a picture as a picture', async () => {
    const user = userEvent.setup();
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto({ name: 'Foto', contentType: 'image/jpeg', url: 'https://storage.test/p.jpg' })]) });
    await user.click(await screen.findByRole('button', { name: 'Zobrazit Foto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Foto' });
    expect(within(dialog).getByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'https://storage.test/p.jpg');
    expect(dialog.querySelector('iframe')).toBeNull();
  });

  it('closes the picture viewer on a tap beside the picture, but not on the picture', async () => {
    const user = userEvent.setup();
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto({ name: 'Foto', contentType: 'image/jpeg', url: 'https://storage.test/p.jpg' })]) });
    await user.click(await screen.findByRole('button', { name: 'Zobrazit Foto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Foto' });
    const picture = within(dialog).getByRole('img', { name: 'Foto' });

    await user.click(picture);
    expect(screen.getByRole('dialog', { name: 'Foto' })).toBeInTheDocument();
    // The empty area is a button stretched behind the picture.
    await user.click(picture.previousElementSibling!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no viewer for Word and Excel files, only the download', async () => {
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto({ name: 'Tabulka', contentType: 'application/vnd.ms-excel' })]) });
    await screen.findByRole('link', { name: 'Stáhnout Tabulka' });
    expect(screen.queryByRole('button', { name: /Zobrazit/ })).not.toBeInTheDocument();
  });

  it('leaves a PDF to the browser on a touch screen: the name link opens a tab, no viewer button', async () => {
    const user = userEvent.setup();
    stubTouchScreen();
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]) });
    const link = await screen.findByRole('link', { name: 'Servisní protokol' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Stáhnout Servisní protokol' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zobrazit/ })).not.toBeInTheDocument();
    await user.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a picture in the viewer on a touch screen too, with a close button, instead of a bare tab', async () => {
    const user = userEvent.setup();
    stubTouchScreen();
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto({ name: 'Foto', contentType: 'image/png', url: 'https://storage.test/p.png' })]) });
    expect(await screen.findByRole('button', { name: 'Zobrazit Foto' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Foto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Foto' });
    expect(within(dialog).getByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'https://storage.test/p.png');
    await user.click(within(dialog).getByRole('button', { name: 'Zavřít' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the viewer from the name of a PDF on a computer', async () => {
    const user = userEvent.setup();
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]) });
    await user.click(await screen.findByRole('link', { name: 'Servisní protokol' }));
    expect(within(await screen.findByRole('dialog')).getByTitle('Servisní protokol')).toHaveAttribute('src', pdfUrl);
  });
});

describe('documents of a service record: adding', () => {
  it('uploads the picked files under their names: URL, bucket, confirm', async () => {
    const user = userEvent.setup();
    const puts: { url: string; type: string | null; range: string | null; size: number }[] = [];
    let stored = false;
    const calls = open({
      [`GET ${documentsUrl}`]: () => jsonResponse(stored ? [documentDto()] : []),
      [`POST ${documentsUrl}/upload-url`]: () => jsonResponse({ key: 'service-records/r/k1.pdf', uploadUrl: 'https://storage.test/upload/k1?sig=1' }),
      'PUT /upload/k1': async (request) => {
        puts.push({ url: request.url, type: request.headers.get('content-type'), range: request.headers.get('x-goog-content-length-range'), size: (await request.blob()).size });
        return new Response(null, { status: 200 });
      },
      [`POST ${documentsUrl}`]: () => {
        stored = true;
        return jsonResponse(documentDto(), { status: 201 });
      },
    });
    await screen.findByText('Zatím žádné dokumenty');

    await user.upload(fileInput(), pdf('revize-2026.pdf', 5000));
    const dialog = await screen.findByRole('dialog', { name: 'Nahrát dokumenty' });
    const name = within(dialog).getByRole('textbox', { name: 'revize-2026.pdf' });
    expect(name).toHaveValue('revize-2026');
    await user.clear(name);
    await user.type(name, '  Revizní zpráva ');
    await user.click(within(dialog).getByRole('button', { name: 'Nahrát' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(puts).toEqual([{ url: 'https://storage.test/upload/k1?sig=1', type: PDF, range: '0,5000', size: 5000 }]);
    const post = (path: string) => calls.find((c) => c.method === 'POST' && new URL(c.url).pathname === path)!;
    expect(await post(`${documentsUrl}/upload-url`).clone().json()).toEqual({ contentType: PDF, size: 5000 });
    expect(await post(documentsUrl).clone().json()).toEqual({ key: 'service-records/r/k1.pdf', name: 'Revizní zpráva' });
    expect(await screen.findByText('Uloženo')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Servisní protokol' })).toBeInTheDocument();
  });

  it('uploads several files one after another, and pictures as shrunken JPEGs', async () => {
    // A phone may hand over a HEIC photo whatever the picker's `accept` says.
    const user = userEvent.setup({ applyAccept: false });
    const order: string[] = [];
    let n = 0;
    const calls = open({
      [`POST ${documentsUrl}/upload-url`]: async (request) => {
        const body = (await request.json()) as { contentType: string; size: number };
        order.push(`url ${body.contentType} ${body.size}`);
        n++;
        return jsonResponse({ key: `service-records/r/k${n}`, uploadUrl: `https://storage.test/upload/k${n}` });
      },
      'PUT /upload/k1': () => {
        order.push('put 1');
        return new Response(null, { status: 200 });
      },
      'PUT /upload/k2': () => {
        order.push('put 2');
        return new Response(null, { status: 200 });
      },
      [`POST ${documentsUrl}`]: async (request) => {
        order.push(`confirm ${((await request.json()) as { name: string }).name}`);
        return jsonResponse(documentDto(), { status: 201 });
      },
    });
    await screen.findByText('Zatím žádné dokumenty');

    const photo = new File([new Uint8Array(9_000_000)], 'IMG_0042.HEIC', { type: 'image/heic' });
    await user.upload(fileInput(), [photo, pdf('a.pdf', 10)]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Nahrát' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(order).toEqual(['url image/jpeg 4321', 'put 1', 'confirm IMG_0042', `url ${PDF} 10`, 'put 2', 'confirm a']);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.headers.get('content-type')).toBe('image/jpeg');
  });

  it('names a camera shot after the day and offers the camera only on a touch screen', async () => {
    const user = userEvent.setup();
    stubTouchScreen();
    open();
    await screen.findByText('Zatím žádné dokumenty');
    expect(screen.getByRole('button', { name: 'Vyfotit' })).toBeInTheDocument();
    expect(fileInput('camera')).toHaveAttribute('capture', 'environment');
    expect(fileInput('camera').accept).toContain('image/jpeg');
    expect(fileInput('camera').accept).not.toContain('pdf');

    await user.upload(fileInput('camera'), new File([new Uint8Array(100)], 'image.jpg', { type: 'image/jpeg' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toMatch(/^Foto \d{1,2}\.\s\d{1,2}\.\s\d{4}$/);
  });

  it('has no camera button on a computer', async () => {
    open();
    await screen.findByText('Zatím žádné dokumenty');
    expect(screen.queryByRole('button', { name: 'Vyfotit' })).not.toBeInTheDocument();
  });

  it('accepts PDF, pictures, Word and Excel in the file picker', async () => {
    open();
    await screen.findByText('Zatím žádné dokumenty');
    for (const part of [PDF, 'image/jpeg', 'image/png', 'image/webp', '.docx', '.xlsx', '.doc', '.xls']) {
      expect(fileInput().accept).toContain(part);
    }
    expect(fileInput()).toHaveAttribute('multiple');
  });

  it('refuses a type that cannot be attached and a file over 20 MB before uploading anything', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const calls = open();
    await screen.findByText('Zatím žádné dokumenty');
    const big = pdf('velky.pdf');
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    await user.upload(fileInput(), [new File(['x'], 'archiv.zip', { type: 'application/zip' }), big]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nahrát lze jen PDF, obrázky a soubory Wordu a Excelu.')).toBeInTheDocument();
    expect(within(dialog).getByText('Dokument je příliš velký (nejvýše 20 MB).')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Nahrát' })).toBeDisabled();
    // Taking the refused files out leaves nothing to upload and closes the dialog.
    await user.click(within(dialog).getByRole('button', { name: 'Odebrat archiv.zip' }));
    await user.click(within(dialog).getByRole('button', { name: 'Odebrat velky.pdf' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('does not upload with a blank or overlong name', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Zatím žádné dokumenty');
    await user.upload(fileInput(), pdf());
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByRole('textbox');
    await user.clear(name);
    expect(within(dialog).getByText('Zadejte název.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Nahrát' })).toBeDisabled();
    await user.type(name, 'x'.repeat(201));
    expect(within(dialog).getByText('Název může mít nejvýše 200 znaků.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Nahrát' })).toBeDisabled();
  });

  it('keeps a failed file in the dialog with the reason, and uploads it on the second try', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    open({
      [`POST ${documentsUrl}/upload-url`]: () => jsonResponse({ key: 'service-records/r/k1.pdf', uploadUrl: 'https://storage.test/upload/k1' }),
      'PUT /upload/k1': () => (++attempts === 1 ? new Response('denied', { status: 403 }) : new Response(null, { status: 200 })),
      [`POST ${documentsUrl}`]: () => jsonResponse(documentDto(), { status: 201 }),
    });
    await screen.findByText('Zatím žádné dokumenty');
    await user.upload(fileInput(), pdf());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Nahrát' }));

    expect(await within(dialog).findByText('Soubor se nepodařilo nahrát. Zkontrolujte připojení a zkuste to znovu.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(attempts).toBe(2);
  });

  it('shows the API reason when it refuses the upload, e.g. under an archived record', async () => {
    const user = userEvent.setup();
    open({ [`POST ${documentsUrl}/upload-url`]: () => problem(409, 'archived') });
    await screen.findByText('Zatím žádné dokumenty');
    await user.upload(fileInput(), pdf());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Nahrát' }));
    expect(await within(dialog).findByText(/archivovan/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lets the user cancel before uploading', async () => {
    const user = userEvent.setup();
    const calls = open();
    await screen.findByText('Zatím žádné dokumenty');
    await user.upload(fileInput(), pdf());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Zrušit' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('documents of a service record: rename and delete', () => {
  const withDocument = (extra: Routes = {}) =>
    open({ [`GET ${documentsUrl}`]: () => jsonResponse([documentDto()]), ...extra });
  const documentUrl = `${documentsUrl}/${documentDto().id}`;

  it('renames a document with the version it was loaded with', async () => {
    const user = userEvent.setup();
    const calls = withDocument({
      [`PATCH ${documentUrl}`]: () => jsonResponse(documentDto({ name: 'Nový název', version: 2 })),
    });
    await user.click(await screen.findByRole('button', { name: 'Přejmenovat Servisní protokol' }));
    const dialog = await screen.findByRole('dialog', { name: 'Přejmenovat dokument' });
    const name = within(dialog).getByRole('textbox', { name: 'Název' });
    expect(name).toHaveValue('Servisní protokol');
    await user.clear(name);
    await user.type(name, 'Nový název');
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(await patch.clone().json()).toEqual({ name: 'Nový název', version: 1 });
    expect(await screen.findByText('Uloženo')).toBeInTheDocument();
  });

  it('says so when someone else changed the document, and the second save carries the version that won', async () => {
    const user = userEvent.setup();
    let version = 1;
    const versions: number[] = [];
    withDocument({
      [`GET ${documentsUrl}`]: () => jsonResponse([documentDto({ version })]),
      [`PATCH ${documentUrl}`]: async (request) => {
        const sent = ((await request.json()) as { version: number }).version;
        versions.push(sent);
        if (sent === version) return jsonResponse(documentDto({ version: version + 1 }));
        return problem(409, 'conflict');
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Přejmenovat Servisní protokol' }));
    const dialog = await screen.findByRole('dialog');
    // Someone else renames it meanwhile: the server is at version 2, our dialog still knows 1.
    version = 2;
    await user.type(within(dialog).getByRole('textbox'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Záznam mezitím někdo upravil');

    // The list was refetched behind the dialog; saving again uses its version, and our typed name is kept.
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(versions).toEqual([1, 2]);
  });

  it('closes the rename dialog when the document is gone from the list', async () => {
    const user = userEvent.setup();
    let gone = false;
    withDocument({ [`GET ${documentsUrl}`]: () => jsonResponse(gone ? [] : [documentDto()]), [`PATCH ${documentUrl}`]: () => problem(404, 'not_found') });
    await user.click(await screen.findByRole('button', { name: 'Přejmenovat Servisní protokol' }));
    const dialog = await screen.findByRole('dialog');
    gone = true;
    await user.type(within(dialog).getByRole('textbox'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not save a blank name', async () => {
    const user = userEvent.setup();
    withDocument();
    await user.click(await screen.findByRole('button', { name: 'Přejmenovat Servisní protokol' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox'));
    expect(within(dialog).getByText('Zadejte název.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Uložit' })).toBeDisabled();
  });

  it('asks before deleting, then deletes', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const calls = open({
      [`GET ${documentsUrl}`]: () => jsonResponse(deleted ? [] : [documentDto()]),
      [`DELETE ${documentUrl}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Smazat Servisní protokol' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Smazat dokument?' });
    expect(within(dialog).getByText(/Dokument „Servisní protokol“ se odstraní/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Smazat Servisní protokol' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Smazat' }));
    expect(await screen.findByText('Zatím žádné dokumenty')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
