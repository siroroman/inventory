import { afterEach, describe, expect, it } from 'vitest';
import {
  chosenRows,
  emptySelection,
  hasChoices,
  inView,
  isChosen,
  loadSelection,
  toggledFor,
} from '../src/features/labels/selection';

const row = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  name: `Položka ${code}`,
  path: 'Centrála',
  accountingId: `73-${code}` as string | null,
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

  it('leaves out the items the user turned off and lists an item once', () => {
    const listed = [row('INV-00002'), row('INV-00001')];
    const selection = { ...emptySelection, toggled: ['id-INV-00002'], added: [{ ...row('INV-00001'), checked: true }] };
    expect(chosenRows(listed, selection).map((r) => r.code)).toEqual(['INV-00001']);
  });

  it('chooses the items with an accounting number at the start and none of the others', () => {
    const listed = [row('INV-00001'), row('INV-00002', { accountingId: null }), row('INV-00003')];
    expect(chosenRows(listed, emptySelection).map((r) => r.code)).toEqual(['INV-00001', 'INV-00003']);
  });

  it('turns an item the other way when it is toggled, whichever way it started', () => {
    const listed = [row('INV-00001'), row('INV-00002', { accountingId: null })];
    const selection = { ...emptySelection, toggled: ['id-INV-00001', 'id-INV-00002'] };
    expect(isChosen(listed[0]!, selection)).toBe(false);
    expect(isChosen(listed[1]!, selection)).toBe(true);
    expect(chosenRows(listed, selection).map((r) => r.code)).toEqual(['INV-00002']);
  });
});

describe('toggledFor', () => {
  const listed = [row('INV-00001'), row('INV-00002', { accountingId: null }), row('INV-00003')];
  const chosenBy = (wanted: (r: (typeof listed)[number]) => boolean) =>
    chosenRows(listed, { ...emptySelection, toggled: toggledFor(listed, wanted) }).map((r) => r.code);

  it('is empty for "the accountant\'s items", the start state', () => {
    expect(toggledFor(listed, (r) => r.accountingId !== null)).toEqual([]);
  });

  it('makes everything chosen, nothing chosen, or only the accountant\'s items chosen', () => {
    expect(chosenBy(() => true)).toEqual(['INV-00001', 'INV-00002', 'INV-00003']);
    expect(chosenBy(() => false)).toEqual([]);
    expect(chosenBy((r) => r.accountingId !== null)).toEqual(['INV-00001', 'INV-00003']);
  });
});

describe('inView', () => {
  it('lists everything, the items with an accounting number, or those without one', () => {
    const withNumber = row('INV-00001');
    const without = row('INV-00002', { accountingId: null });
    expect([withNumber, without].filter((r) => inView(r, 'all'))).toHaveLength(2);
    expect([withNumber, without].filter((r) => inView(r, 'accounting'))).toEqual([withNumber]);
    expect([withNumber, without].filter((r) => inView(r, 'other'))).toEqual([without]);
  });
});

describe('hasChoices', () => {
  it('is true once something was turned or added, false at the start', () => {
    expect(hasChoices(emptySelection)).toBe(false);
    expect(hasChoices({ ...emptySelection, toggled: ['x'] })).toBe(true);
    expect(hasChoices({ ...emptySelection, added: [{ ...row('INV-00001'), checked: true }] })).toBe(true);
  });
});

describe('loadSelection', () => {
  const location = { id: 'l1', code: 'LOC-1', name: 'Praha', path: 'Praha', itemCount: 3 };
  afterEach(() => sessionStorage.clear());

  it('reads what the tab stored, and gives a stored added item without a number none', () => {
    const { accountingId: _drop, ...oldRow } = row('INV-00009');
    sessionStorage.setItem(
      'labels-wizard',
      JSON.stringify({
        location,
        toggled: ['a', 3, 'b'],
        added: [
          { ...oldRow, checked: false },
          { ...row('INV-00010'), checked: true },
        ],
      }),
    );
    const loaded = loadSelection();
    expect(loaded.toggled).toEqual(['a', 'b']);
    expect(loaded.added.map((r) => [r.code, r.accountingId, r.checked])).toEqual([
      ['INV-00009', null, false],
      ['INV-00010', '73-INV-00010', true],
    ]);
  });

  it('drops the `excluded` list of an older tab: the choice starts again from the new default', () => {
    sessionStorage.setItem('labels-wizard', JSON.stringify({ location, excluded: ['a', 'b'], added: [] }));
    expect(loadSelection()).toEqual({ location, toggled: [], added: [] });
  });
});
