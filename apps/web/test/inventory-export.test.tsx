import type { InventoryExportRowDto } from '@inventory/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { inventoryCsv, inventoryCsvFileName, splitAccountingId } from '../src/features/inventories/export-csv.ts';
import { inventory, person, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

const saved = vi.hoisted(() => [] as { blob: Blob; name: string }[]);
vi.mock('../src/lib/save-file.ts', () => ({
  saveFile: (blob: Blob, name: string) => saved.push({ blob, name }),
}));

const id = '5d9e2a63-8b5c-4e7a-9f1b-0a2c3d4e5f60';
const centre = ref('LOC-74', 'Centrála Hradec Králové');
const room = ref('LOC-120', 'Kancelář');

function row(over: Partial<InventoryExportRowDto> = {}): InventoryExportRowDto {
  return {
    id: crypto.randomUUID(),
    code: 'INV-0001',
    name: 'Tiskárna',
    accountingId: null,
    originalCode: null,
    otherExternalIds: [],
    manufacturer: null,
    model: null,
    serialNumber: null,
    purchasePrice: null,
    result: 'not_checked',
    registeredPath: [centre, room],
    foundPath: [centre, room],
    checkedAt: null,
    checkedBy: null,
    method: null,
    archived: false,
    ...over,
  };
}

/** The file as lines of fields, without the BOM and the last line end. */
const parse = (csv: string) =>
  csv
    .slice(1)
    .split('\r\n')
    .slice(0, -1)
    .map((line) => line.split(';'));

describe('inventory CSV', () => {
  it('is UTF-8 with a BOM, ; between fields and CRLF line ends, with the Czech headings', () => {
    const csv = inventoryCsv([row()]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parse(csv)[0]).toEqual([
      'Středisko',
      'Inv. číslo',
      'ID',
      'Název',
      'Výrobce',
      'Model',
      'Sériové číslo',
      'Původní kód',
      'Další externí ID',
      'Výsledek',
      'Lokalita',
      'Vedeno v',
      'Středisko lokality',
      'Zkontroloval',
      'Čas kontroly',
      'Způsob',
      'Pořizovací cena',
    ]);
  });

  it('splits the accounting ID into the centre and the number the accountant uses', () => {
    const [, line] = parse(
      inventoryCsv([
        row({
          accountingId: '74-1512',
          originalCode: 'HK-0042',
          otherExternalIds: ['Elektrikář: EL-1', 'Servis: S-9'],
          manufacturer: 'Canon',
          model: 'i-SENSYS',
          serialNumber: 'SN-42',
          purchasePrice: 12500.5,
          result: 'found',
          checkedAt: '2026-10-03T07:15:00.000Z',
          checkedBy: person('Roman Siro'),
          method: 'scan',
        }),
      ]),
    );
    expect(line!.slice(0, 13)).toEqual([
      '74',
      '1512',
      'INV-0001',
      'Tiskárna',
      'Canon',
      'i-SENSYS',
      'SN-42',
      'HK-0042',
      'Elektrikář: EL-1, Servis: S-9',
      'Nalezeno',
      'Centrála Hradec Králové › Kancelář',
      'Centrála Hradec Králové › Kancelář',
      '74',
    ]);
    expect(line![13]).toBe('Roman Siro');
    expect(line![14]).toMatch(/^3\. 10\. 2026/);
    expect(line!.slice(15)).toEqual(['Sken', '12500,5']);
    expect(splitAccountingId('2025021')).toEqual({ centre: '', number: '2025021' });
    expect(splitAccountingId(null)).toEqual({ centre: '', number: '' });
  });

  it('sorts by centre and inventory number as numbers, items without an accounting ID last by name', () => {
    const lines = parse(
      inventoryCsv([
        row({ name: 'Židle' }),
        row({ name: 'B', accountingId: '74-2025021' }),
        row({ name: 'A', accountingId: '74-1512' }),
        row({ name: 'C', accountingId: '9-77' }),
        row({ name: 'Čajník' }),
      ]),
    ).slice(1);
    expect(lines.map((l) => l[3])).toEqual(['C', 'A', 'B', 'Čajník', 'Židle']);
  });

  it('names every result in Czech, quotes what holds a separator and keeps formulas as text', () => {
    const results = ['found', 'found_elsewhere', 'new', 'missing', 'not_checked', 'archived'] as const;
    const lines = parse(inventoryCsv(results.map((result, n) => row({ result, accountingId: `1-${n}` })))).slice(1);
    expect(lines.map((l) => l[9])).toEqual(['Nalezeno', 'Nalezeno jinde', 'Nové', 'Chybí', 'Nezkontrolováno', 'Archivováno']);

    const csv = inventoryCsv([row({ name: 'Stůl; "dub"', model: '=HYPERLINK("x")' })]);
    expect(csv).toContain(';"Stůl; ""dub""";');
    expect(csv).toContain(`;"'=HYPERLINK(""x"")";`);
  });

  it('is named after the root and the end date, or today for a run in progress', () => {
    const root = ref('LOC-74', 'Centrála');
    expect(inventoryCsvFileName({ location: root, endedAt: '2026-10-04T10:00:00.000Z' })).toBe('inventura-LOC-74-2026-10-04.csv');
    expect(inventoryCsvFileName({ location: root, endedAt: null }, new Date(2026, 10, 7))).toBe('inventura-LOC-74-2026-11-07.csv');
  });
});

describe('Stáhnout CSV', () => {
  it('is offered to readers too and saves the run as a CSV', async () => {
    saved.length = 0;
    stubApi({
      'GET /api/v1/me': () => jsonResponse({ ...me, role: 'read' }),
      [`GET /api/v1/inventories/${id}`]: () =>
        jsonResponse(inventory({ id, location: centre, path: [centre], status: 'finished', endedAt: '2026-10-04T10:00:00.000Z' })),
      [`GET /api/v1/inventories/${id}/export`]: () => jsonResponse({ items: [row({ accountingId: '74-1512', result: 'found' })] }),
    });
    renderApp(`/inventories/${id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Stáhnout CSV' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('inventura-LOC-74-2026-10-04.csv');
    const text = await saved[0]!.blob.text();
    expect(text).toContain('\r\n74;1512;INV-0001;Tiskárna;');
    expect(await screen.findByText('CSV staženo')).toBeInTheDocument();
    // Readers get no inventory actions.
    expect(screen.queryByRole('button', { name: 'Znovu otevřít inventuru' })).not.toBeInTheDocument();
  });
});
