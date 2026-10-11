import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

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
  if (layout) sessionStorage.setItem('labels-layout', JSON.stringify(layout));
};
const open = (step: number) => renderApp(`/?tab=labels&step=${step}&locationId=${LOCATION.id}`);

const downloads: { name: string; href: string }[] = [];
beforeEach(() => {
  sessionStorage.clear();
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
    expect(screen.getByText('A4 na výšku · 210 × 297 mm')).toBeInTheDocument();
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
    expect(JSON.parse(sessionStorage.getItem('labels-layout')!)).toMatchObject({ columns: 4, rows: 10 });

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

  it('starts from a chosen place, hatches the places before it and resets it with the grid', async () => {
    api();
    remember();
    open(3);
    await screen.findByText('Štítek 66,7 × 35,9 mm');

    expect(screen.getByRole('button', { name: 'Pozice 1' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Pozice 5' }));
    expect(screen.getByRole('button', { name: 'Pozice 5' })).toHaveAttribute('aria-pressed', 'true');
    const sheet = screen.getByRole('img', { name: 'Náhled listu 1' });
    expect(sheet.querySelectorAll('[data-used]')).toHaveLength(4);
    expect(screen.getByText(/na posledním listu zůstane 17 míst prázdných/)).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('labels-layout')!).startPosition).toBe(5);

    await userEvent.click(screen.getByRole('button', { name: 'Přidat: Řádky' }));
    expect(screen.getByRole('button', { name: 'Pozice 1' })).toHaveAttribute('aria-pressed', 'true');
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

    expect(await screen.findByText('PDF je připravené.')).toBeInTheDocument();
    expect(build.buildLabelsPdf).toHaveBeenCalledTimes(1);
    const options = build.buildLabelsPdf.mock.calls[0]![0];
    expect(options.items).toEqual([
      { code: 'INV-00001', name: 'Položka 1' },
      { code: 'INV-00003', name: 'Položka 3' },
    ]);
    expect(options).toMatchObject({ columns: 2, rows: 5, startPosition: 4 });
    expect(options.fonts.regular).toBeInstanceOf(Uint8Array);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^stitky-LOC-004-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(screen.getByText('Tiskněte v měřítku 100 % (bez přizpůsobení stránce).')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout znovu' }));
    expect(downloads).toHaveLength(2);
    expect(build.buildLabelsPdf).toHaveBeenCalledTimes(1);
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
    expect(await screen.findByText('PDF je připravené.')).toBeInTheDocument();

    build.buildLabelsPdf.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF se nepodařilo vytvořit.');
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(await screen.findByText('PDF je připravené.')).toBeInTheDocument();
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
    expect(JSON.parse(sessionStorage.getItem('labels-layout')!)).toEqual({ columns: 4, rows: 6, startPosition: 1 });
  });

  it('goes back to the layout with Zpět, losing nothing', async () => {
    api();
    remember({}, { columns: 4, rows: 6, startPosition: 7 });
    const { router } = open(4);
    await screen.findByRole('button', { name: 'Stáhnout PDF' });
    await userEvent.click(screen.getByRole('button', { name: 'Zpět' }));
    await waitFor(() => expect(router.state.location.search.step).toBe(3));
    expect(await screen.findByLabelText('Sloupce')).toHaveValue('4');
    expect(within(screen.getByRole('group', { name: 'Začít od pozice' })).getByRole('button', { name: 'Pozice 7' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
