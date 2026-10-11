import { describe, expect, it } from 'vitest';
import { chosenRows, emptySelection } from '../src/features/labels/selection';

const row = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  name: `Položka ${code}`,
  path: 'Centrála',
  ...over,
});

describe('chosenRows', () => {
  it('orders the labels by ID with the numbers in it compared by value, items added by hand among them', () => {
    const listed = [row('INV-73-2023016'), row('INV-9-100'), row('INV-10-5'), row('INV-9-20')];
    const selection = {
      ...emptySelection,
      added: [
        { ...row('INV-9-3'), checked: true },
        { ...row('INV-1-1'), checked: false },
      ],
    };
    expect(chosenRows(listed, selection).map((r) => r.code)).toEqual([
      'INV-9-3',
      'INV-9-20',
      'INV-9-100',
      'INV-10-5',
      'INV-73-2023016',
    ]);
  });

  it('leaves out the excluded items and lists an item once', () => {
    const listed = [row('INV-00002'), row('INV-00001')];
    const selection = { ...emptySelection, excluded: ['id-INV-00002'], added: [{ ...row('INV-00001'), checked: true }] };
    expect(chosenRows(listed, selection).map((r) => r.code)).toEqual(['INV-00001']);
  });
});
