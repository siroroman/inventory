import type { InventoryRowDto } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { groupRows } from '../src/features/inventories/checklist.ts';
import { fold, matchesWords } from '../src/lib/search.ts';
import { inventoryRow, person } from './fixtures.ts';

const row = (name: string, over: Record<string, unknown> = {}) => inventoryRow({ name, ...over }) as InventoryRowDto;
const checked = (at: string) => ({ checkedAt: `2026-10-03T${at}:00.000Z`, checkedBy: person(), method: 'manual' });

describe('search folding', () => {
  it('ignores case and diacritics', () => {
    expect(fold('Žebřík ŮČÁRY')).toBe('zebrik ucary');
    expect(matchesWords(['Žebřík hliníkový', 'INV-00053'], 'ZEBRIK hlin')).toBe(true);
  });

  it('wants every word somewhere, in any of the texts', () => {
    expect(matchesWords(['Regál kovový A', 'INV-00050'], 'regal inv-00050')).toBe(true);
    expect(matchesWords(['Regál kovový A', 'INV-00050'], 'regal židle')).toBe(false);
  });

  it('matches everything for a blank search', () => {
    expect(matchesWords(['cokoli'], '')).toBe(true);
    expect(matchesWords(['cokoli'], '   ')).toBe(true);
  });
});

describe('groupRows', () => {
  it('puts the unchecked by name in Czech order and the checked with the newest check first', () => {
    const groups = groupRows(
      [
        row('Žebřík'),
        row('Čepice'),
        row('Cukřenka'),
        row('Mixér'),
        row('Starší', checked('09:00')),
        row('Nejnovější', checked('11:30')),
        row('Prostřední', checked('10:15')),
      ],
      '',
    );
    expect(groups.unchecked.map((r) => r.name)).toEqual(['Cukřenka', 'Čepice', 'Mixér', 'Žebřík']);
    expect(groups.checked.map((r) => r.name)).toEqual(['Nejnovější', 'Prostřední', 'Starší']);
  });

  it('orders rows with the same name or the same moment by id, so the list does not jump on a refresh', () => {
    const a = row('Židle', { id: '00000000-0000-4000-8000-000000000001' });
    const b = row('Židle', { id: '00000000-0000-4000-8000-000000000002' });
    expect(groupRows([b, a], '').unchecked.map((r) => r.id)).toEqual([a.id, b.id]);
    const c = row('Stůl', { ...checked('10:00'), id: '00000000-0000-4000-8000-000000000003' });
    const d = row('Stůl', { ...checked('10:00'), id: '00000000-0000-4000-8000-000000000004' });
    expect(groupRows([d, c], '').checked.map((r) => r.id)).toEqual([c.id, d.id]);
  });

  it('keeps the rows whose name or ID has every word of the search', () => {
    const rows = [
      row('Žebřík hliníkový', { code: 'INV-00053' }),
      row('Regál kovový A', { code: 'INV-00050' }),
      row('Regál kovový B', { code: 'INV-00051', ...checked('10:00') }),
    ];
    expect(groupRows(rows, 'zebrik').unchecked.map((r) => r.name)).toEqual(['Žebřík hliníkový']);
    expect(groupRows(rows, 'regal kovovy').unchecked.map((r) => r.name)).toEqual(['Regál kovový A']);
    expect(groupRows(rows, 'regal kovovy').checked.map((r) => r.name)).toEqual(['Regál kovový B']);
    expect(groupRows(rows, 'inv-00051').unchecked).toEqual([]);
    expect(groupRows(rows, 'nic takového')).toEqual({ unchecked: [], checked: [] });
  });
});
