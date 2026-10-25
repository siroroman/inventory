import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, me, renderApp, stubApi, stubTouchScreen } from './helpers.tsx';

const build = vi.hoisted(() => ({ buildLabelsPdf: vi.fn() }));
vi.mock('../src/features/labels/build-pdf.ts', () => build);
vi.mock('../src/features/labels/fonts.ts', () => ({
  PREVIEW_FONT: 'LabelRoboto',
  loadPreviewFonts: async () => {},
  loadLabelFonts: async () => ({ regular: new Uint8Array([1]), bold: new Uint8Array([2]) }),
}));

const LOCATION = {
  id: '5f0b9d3e-5a53-4a57-8d0a-64d2a6a3c001',
  code: 'LOC-004',
  name: 'Přízemí',
  path: 'Centrála Praha › Přízemí',
  itemCount: 3,
};

const labelItem = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  code: `INV-${String(n).padStart(5, '0')}`,
  name: `Položka ${n}`,
  path: 'Centrála Praha › Přízemí › Kuchyně',
});

function api(count = 3) {
  const items = Array.from({ length: count }, (_, i) => labelItem(i + 1));
  stubApi({
    'GET /api/v1/me': () => jsonResponse(me),
    'GET /api/v1/items/labels': () => jsonResponse({ items, total: items.length }),
  });
  return items;
}

const remember = (selection: Record<string, unknown> = {}, layout?: Record<string, unknown>) => {
  sessionStorage.setItem(
    'labels-wizard',
    JSON.stringify({ location: LOCATION, excluded: [], added: [], ...selection }),
  );
  if (layout) {
    // The device keeps the format and the grid; the place on the sheet lasts for the tab.
    const { startPosition, ...settings } = layout;
    localStorage.setItem('labels-layout', JSON.stringify(settings));
    if (startPosition !== undefined) sessionStorage.setItem('labels-start', JSON.stringify(startPosition));
  }
};
const storedLayout = () => JSON.parse(localStorage.getItem('labels-layout')!);
const storedStart = () => JSON.parse(sessionStorage.getItem('labels-start')!);
const open = (step: number) => renderApp(`/?tab=labels&step=${step}&locationId=${LOCATION.id}`);

const downloads: { name: string; href: string }[] = [];
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  build.buildLabelsPdf.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  downloads.length = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:labels', revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('labels wizard: step 3, the layout', () => {
  it('shows the fixed format, 3 × 8, the size of a label, the summary and the first sheet', async () => {
    api();
    remember();
    open(3);

    expect(await screen.findByRole('heading', { name: 'Rozložení' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'A4 tiskárna' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Štítkovač' })).not.toBeChecked();
    expect(screen.getByText(/A4 na výšku · 210 × 297 mm/)).toBeInTheDocument();
    expect(screen.getByLabelText('Sloupce')).toHaveValue('3');
    expect(screen.getByLabelText('Řádky')).toHaveValue('8');
    expect(screen.getByText('Štítek 66,7 × 35,9 mm')).toBeInTheDocument();
    expect(screen.getByText(/Okraj stránky 5 mm/)).toBeInTheDocument();
    expect(screen.getByText('3 štítky · 1 list · na posledním listu zůstane 21 míst prázdných')).toBeInTheDocument();
    const sheet = screen.getByRole('img', { name: 'Náhled listu 1' });
    expect(sheet.querySelectorAll('[data-label]')).toHaveLength(3);
    expect(sheet.querySelector('[data-label="INV-00001"] path')).not.toBeNull();
    expect(sheet.querySelector('[data-label="INV-00001"]')).toHaveTextContent('INV-00001');
    expect(sheet.querySelector('[data-label="INV-00001"]')).toHaveTextContent('Položka 1');
    expect(screen.getByText('List 1 z 1')).toBeInTheDocument();
  });

  it('changes the grid with the buttons and by typing, keeps it, and updates the size', async () => {
    api();
    remember();
    open(3);
    await screen.findByText('Štítek 66,7 × 35,9 mm');

    await userEvent.click(screen.getByRole('button', { name: 'Přidat: Sloupce' }));
    expect(screen.getByLabelText('Sloupce')).toHaveValue('4');
    expect(screen.getByText('Štítek 50,0 × 35,9 mm')).toBeInTheDocument();

    const rows = screen.getByLabelText('Řádky');
    await userEvent.clear(rows);
    await userEvent.type(rows, '10{Enter}');
    expect(rows).toHaveValue('10');
    expect(screen.getByText('Štítek 50,0 × 28,7 mm')).toBeInTheDocument();
    expect(storedLayout()).toMatchObject({ columns: 4, rows: 10 });

    // A number out of range is brought to the nearest allowed one.
    await userEvent.clear(rows);
    await userEvent.type(rows, '99');
    await userEvent.tab();
    expect(rows).toHaveValue('16');
    expect(screen.getByRole('button', { name: 'Přidat: Řádky' })).toBeDisabled();
  });

  it('warns, without blocking, when the QR code would be too small', async () => {
    api();
    remember({}, { columns: 5, rows: 14, startPosition: 1 });
    open(3);
    expect(await screen.findByRole('alert')).toHaveTextContent('Štítky jsou příliš malé, QR kód by se špatně četl.');
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Ubrat: Řádky' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to a label printer: size of one label, a preview of each label, no sheet or start place', async () => {
    api();
    remember();
    open(3);
    await screen.findByText('Štítek 66,7 × 35,9 mm');

    await userEvent.click(screen.getByRole('radio', { name: 'Štítkovač' }));
    expect(screen.getByLabelText('Šířka (mm)')).toHaveValue('50');
    expect(screen.getByLabelText('Výška (mm)')).toHaveValue('24');
    expect(screen.getByText('Štítek 50 × 24 mm')).toBeInTheDocument();
    expect(screen.getByText('Výška je šířka pásky, šířka je délka štítku.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sloupce')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Začít od pozice')).not.toBeInTheDocument();
    expect(screen.queryByText(/Okraj stránky/)).not.toBeInTheDocument();
    expect(screen.getByText('3 štítky · každý na vlastní stránce PDF')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // One label at a time, in its real proportions, through all the labels.
    const label = screen.getByRole('img', { name: 'Náhled štítku 1' });
    expect(label).toHaveAttribute('viewBox', '0 0 50 24');
    expect(label).toHaveTextContent('INV-00001');
    expect(label.querySelector('path')).not.toBeNull();
    expect(screen.getByText('Štítek 1 z 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Předchozí štítek' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Další štítek' }));
    expect(screen.getByRole('img', { name: 'Náhled štítku 2' })).toHaveTextContent('Položka 2');
    expect(screen.getByText('Štítek 2 z 3')).toBeInTheDocument();

    expect(storedLayout()).toMatchObject({ format: 'tape', width: 50, height: 24 });
  });

  it('keeps the label size and the grid when the format is switched back and forth', async () => {
    api();
    remember();
    open(3);
    await screen.findByText('Štítek 66,7 × 35,9 mm');

    await userEvent.click(screen.getByRole('button', { name: 'Přidat: Sloupce' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Štítkovač' }));
    const width = screen.getByLabelText('Šířka (mm)');
    await userEvent.clear(width);
    await userEvent.type(width, '40{Enter}');
    expect(screen.getByText('Štítek 40 × 24 mm')).toBeInTheDocument();

    // Typing outside 10 to 100 mm is brought to the nearest allowed size.
    const height = screen.getByLabelText('Výška (mm)');
    await userEvent.clear(height);
    await userEvent.type(height, '5');
    await userEvent.tab();
    expect(height).toHaveValue('10');

    await userEvent.click(screen.getByRole('radio', { name: 'A4 tiskárna' }));
    expect(screen.getByLabelText('Sloupce')).toHaveValue('4');
    await userEvent.click(screen.getByRole('radio', { name: 'Štítkovač' }));
    expect(screen.getByLabelText('Šířka (mm)')).toHaveValue('40');
  });

  it('warns, without blocking, when the label of a narrow tape would hold only a small QR code', async () => {
    api();
    remember({}, { format: 'tape', width: 40, height: 12 });
    open(3);
    expect(await screen.findByRole('alert')).toHaveTextContent('Štítky jsou příliš malé, QR kód by se špatně četl.');
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Přidat: Výška (mm)' }));
    for (let i = 0; i < 8; i++) await userEvent.click(screen.getByRole('button', { name: 'Přidat: Výška (mm)' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts from a chosen place, hatches the places before it and resets it with the grid', async () => {
    api();
    remember();
    open(3);
    await screen.findByText('Štítek 66,7 × 35,9 mm');

    const start = screen.getByLabelText('Začít od pozice');
    expect(start).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Ubrat: Začít od pozice' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Přidat: Začít od pozice' }));
    expect(start).toHaveValue('2');
    await userEvent.clear(start);
    await userEvent.type(start, '5');
    await userEvent.tab();
    expect(start).toHaveValue('5');
    const sheet = screen.getByRole('img', { name: 'Náhled listu 1' });
    expect(sheet.querySelectorAll('[data-used]')).toHaveLength(4);
    expect(screen.getByText(/na posledním listu zůstane 17 míst prázdných/)).toBeInTheDocument();
    expect(storedStart()).toBe(5);

    await userEvent.click(screen.getByRole('button', { name: 'Přidat: Řádky' }));
    expect(screen.getByLabelText('Začít od pozice')).toHaveValue('1');
    expect(screen.getByRole('img', { name: 'Náhled listu 1' }).querySelectorAll('[data-used]')).toHaveLength(0);
  });

  it('pages through the sheets of the preview and counts the sheets and what stays empty', async () => {
    api(118);
    remember();
    open(3);

    expect(
      await screen.findByText('118 štítků · 5 listů · na posledním listu zůstanou 2 místa prázdná'),
    ).toBeInTheDocument();
    expect(screen.getByText('List 1 z 5')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Náhled listu 1' }).querySelectorAll('[data-label]')).toHaveLength(24);
    expect(screen.getByRole('button', { name: 'Předchozí list' })).toBeDisabled();

    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole('button', { name: 'Další list' }));
    expect(screen.getByText('List 5 z 5')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Náhled listu 5' }).querySelectorAll('[data-label]')).toHaveLength(22);
    expect(screen.getByRole('button', { name: 'Další list' })).toBeDisabled();
  });

  it('opens the sheet full screen, pages there and closes again', async () => {
    api(30);
    remember();
    open(3);

    await userEvent.click(await screen.findByRole('button', { name: 'Zobrazit náhled na celou obrazovku' }));
    const dialog = await screen.findByRole('dialog', { name: 'Náhled tisku' });
    expect(within(dialog).getByRole('img', { name: 'Náhled listu 1' }).querySelectorAll('[data-label]')).toHaveLength(24);
    expect(within(dialog).getByText('List 1 z 2')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Další list' }));
    expect(within(dialog).getByRole('img', { name: 'Náhled listu 2' }).querySelectorAll('[data-label]')).toHaveLength(6);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Zavřít' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The sheet shown beside the controls stayed on the page chosen in the full-screen view.
    expect(screen.getByText('List 2 z 2')).toBeInTheDocument();
  });

  it('goes back to step 2 for a list that cannot be printed', async () => {
    const items = api();
    remember({ excluded: items.map((item) => item.id) });
    const { router } = open(3);
    await waitFor(() => expect(router.state.location.search.step).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Vyberte položky' })).toBeInTheDocument();
  });
});

describe('labels wizard: step 4, the download', () => {
  it('summarises the sheet and makes the PDF in the browser with what was chosen', async () => {
    const items = api();
    remember({ excluded: [items[1]!.id] }, { columns: 2, rows: 5, startPosition: 4 });
    open(4);

    expect(await screen.findByRole('heading', { name: 'Stažení' })).toBeInTheDocument();
    expect(screen.getByText('Přízemí')).toBeInTheDocument();
    expect(screen.getByText('2 štítky')).toBeInTheDocument();
    expect(screen.getByText('2 × 5 · A4')).toBeInTheDocument();
    expect(screen.getByText('od pozice 4')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout PDF' }));

    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();
    expect(build.buildLabelsPdf).toHaveBeenCalledTimes(1);
    const options = build.buildLabelsPdf.mock.calls[0]![0];
    expect(options.items).toEqual([
      { code: 'INV-00001', name: 'Položka 1' },
      { code: 'INV-00003', name: 'Položka 3' },
    ]);
    expect(options).toMatchObject({ columns: 2, rows: 5, startPosition: 4 });
    expect(options.fonts.regular).toBeInstanceOf(Uint8Array);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^stitky-Přízemí-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(screen.getByText('Tiskněte v měřítku 100 % (bez přizpůsobení stránce).')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout PDF' }));
    expect(downloads).toHaveLength(2);
    expect(build.buildLabelsPdf).toHaveBeenCalledTimes(1);
  });

  it('makes a PDF of one label per page for a label printer, and summarises it without a sheet', async () => {
    const items = api();
    remember({ excluded: [items[1]!.id] }, { format: 'tape', width: 40, height: 20, columns: 2, rows: 5 });
    open(4);

    expect(await screen.findByRole('heading', { name: 'Stažení' })).toBeInTheDocument();
    expect(screen.getByText('Štítkovač · 40 × 20 mm')).toBeInTheDocument();
    expect(screen.getByText('Stran PDF')).toBeInTheDocument();
    expect(screen.queryByText('Listy')).not.toBeInTheDocument();
    expect(screen.queryByText('Začátek')).not.toBeInTheDocument();
    expect(screen.getByText(/aplikaci štítkovače/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout PDF' }));
    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();

    const options = build.buildLabelsPdf.mock.calls[0]![0];
    expect(options).toMatchObject({ format: 'tape', width: 40, height: 20 });
    expect(options).not.toHaveProperty('columns');
    expect(options.items).toHaveLength(2);
    expect(downloads).toHaveLength(1);
  });

  it('shows the work in progress, and an error with a retry', async () => {
    api();
    remember();
    let finish: (bytes: Uint8Array) => void = () => {};
    build.buildLabelsPdf.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    open(4);

    await userEvent.click(await screen.findByRole('button', { name: 'Stáhnout PDF' }));
    expect(await screen.findByText('Připravuje se PDF…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stáhnout PDF' })).toBeDisabled();
    finish(new Uint8Array([1]));
    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    api();
    remember();
    build.buildLabelsPdf.mockRejectedValueOnce(new Error('boom'));
    open(4);

    await userEvent.click(await screen.findByRole('button', { name: 'Stáhnout PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF se nepodařilo vytvořit.');
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();
    expect(downloads).toHaveLength(1);
  });

  it('prints the PDF from a hidden frame, and makes it only once for a download and a print', async () => {
    api();
    remember();
    open(4);
    const print = vi.fn();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({ focus: vi.fn(), print } as never);

    await userEvent.click(await screen.findByRole('button', { name: 'Vytisknout' }));
    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();
    const frame = document.body.querySelector('iframe');
    expect(frame).toHaveAttribute('src', 'blob:labels');
    expect(print).not.toHaveBeenCalled();
    frame!.dispatchEvent(new Event('load'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(downloads).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout PDF' }));
    expect(downloads).toHaveLength(1);
    expect(build.buildLabelsPdf).toHaveBeenCalledTimes(1);
  });

  it('shows an error with a retry that prints again when the PDF cannot be made for printing', async () => {
    api();
    remember();
    open(4);
    build.buildLabelsPdf.mockRejectedValueOnce(new Error('boom'));
    const print = vi.fn();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({ focus: vi.fn(), print } as never);

    await userEvent.click(await screen.findByRole('button', { name: 'Vytisknout' }));
    expect(await screen.findByText('PDF se nepodařilo vytvořit.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    await waitFor(() => expect(document.body.querySelector('iframe')).not.toBeNull());
    expect(downloads).toHaveLength(0);
  });

  it('starts over after a download: nothing chosen, back at step 1, the sheet kept from its first place', async () => {
    api();
    remember({}, { columns: 4, rows: 6, startPosition: 7 });
    const { router } = open(4);

    await userEvent.click(await screen.findByRole('button', { name: 'Stáhnout PDF' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Vytvořit nové štítky' }));

    expect(await screen.findByRole('heading', { name: 'Vyberte lokalitu' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'labels' }));
    expect(JSON.parse(sessionStorage.getItem('labels-wizard')!).location).toBeNull();
    expect(storedLayout()).toMatchObject({ columns: 4, rows: 6 });
    expect(storedStart()).toBe(1);
  });

  it('goes back to the layout with Zpět, losing nothing', async () => {
    api();
    remember({}, { columns: 4, rows: 6, startPosition: 7 });
    const { router } = open(4);
    await screen.findByRole('button', { name: 'Stáhnout PDF' });
    await userEvent.click(screen.getByRole('button', { name: 'Zpět' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(3));
    expect(await screen.findByLabelText('Sloupce')).toHaveValue('4');
    expect(screen.getByLabelText('Začít od pozice')).toHaveValue('7');
  });
});

describe('labels wizard: step 4, sharing the PDF with a label printer app', () => {
  const TAPE = { format: 'tape', width: 50, height: 24 };

  /** A phone's system share sheet: `navigator.share` and `canShare` exist only there. */
  function stubShareSheet(share = vi.fn().mockResolvedValue(undefined)) {
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    return share;
  }
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  it('offers Sdílet instead of Vytisknout on a phone, and hands the PDF over as a file', async () => {
    api();
    remember({}, TAPE);
    stubTouchScreen();
    const share = stubShareSheet();
    open(4);

    expect(await screen.findByRole('button', { name: 'Stáhnout PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vytisknout' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sdílet' }));

    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();
    expect(share).toHaveBeenCalledTimes(1);
    const file: File = share.mock.calls[0]![0].files[0];
    expect(file.name).toMatch(/^stitky-Přízemí-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(file.type).toBe('application/pdf');
    expect(downloads).toHaveLength(0);

    // The PDF is not made twice for a share and a download.
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout PDF' }));
    expect(downloads).toHaveLength(1);
    expect(build.buildLabelsPdf).toHaveBeenCalledTimes(1);
  });

  it('is not an error to close the share sheet without choosing an app', async () => {
    api();
    remember({}, TAPE);
    stubTouchScreen();
    stubShareSheet(vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    open(4);

    await userEvent.click(await screen.findByRole('button', { name: 'Sdílet' }));
    expect(await screen.findByRole('button', { name: 'Vytvořit nové štítky' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error with a retry when sharing fails for another reason', async () => {
    api();
    remember({}, TAPE);
    stubTouchScreen();
    stubShareSheet(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')));
    open(4);

    await userEvent.click(await screen.findByRole('button', { name: 'Sdílet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF se nepodařilo vytvořit.');
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('keeps Vytisknout on a computer, for a label printer too', async () => {
    api();
    remember({}, TAPE);
    stubShareSheet();
    open(4);
    expect(await screen.findByRole('button', { name: 'Vytisknout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sdílet' })).not.toBeInTheDocument();
  });

  it('keeps Vytisknout for A4 sheets on a phone', async () => {
    api();
    remember();
    stubTouchScreen();
    stubShareSheet();
    open(4);
    expect(await screen.findByRole('button', { name: 'Vytisknout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sdílet' })).not.toBeInTheDocument();
  });

  it('keeps Vytisknout on a phone that cannot share files', async () => {
    api();
    remember({}, TAPE);
    stubTouchScreen();
    open(4);
    expect(await screen.findByRole('button', { name: 'Vytisknout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sdílet' })).not.toBeInTheDocument();
  });
});

describe('pdfFileName', () => {
  it('names the file after the location, keeps Czech letters and drops what a file name cannot hold', async () => {
    const { pdfFileName } = await import('../src/features/labels/download.ts');
    const day = new Date(2026, 9, 11);
    expect(pdfFileName({ code: 'LOC-004', name: 'Centrála  Hradec Králové' }, day)).toBe(
      'stitky-Centrála-Hradec-Králové-2026-10-11.pdf',
    );
    expect(pdfFileName({ code: 'LOC-004', name: 'Sklad A/B: "nový"?' }, day)).toBe('stitky-Sklad-AB-nový-2026-10-11.pdf');
    expect(pdfFileName({ code: 'LOC-004', name: '???' }, day)).toBe('stitky-LOC-004-2026-10-11.pdf');
    expect(pdfFileName({ code: 'LOC-004', name: 'x'.repeat(100) }, day)).toBe(`stitky-${'x'.repeat(60)}-2026-10-11.pdf`);
  });
});
