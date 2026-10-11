import { describe, expect, it } from 'vitest';
import { breakId, fitLabelText, type Measure, wrapName } from '../src/features/labels/fit-text.ts';

/** Every character is half an em wide, bold or not: simple to reason about. */
const measure: Measure = (text, size) => text.length * size * 0.5;
const MM = 72 / 25.4;
/** A box `chars` characters wide at 11 pt. */
const boxFor = (chars: number, height = 30) => ({ width: (chars * 11 * 0.5) / MM, height });

describe('wrapName', () => {
  const fits = (n: number) => (text: string) => text.length <= n;

  it('keeps a short name on one line and wraps on words', () => {
    expect(wrapName('Notebook Dell', 2, fits(20))).toEqual(['Notebook Dell']);
    expect(wrapName('Konvektomat Rational iCombi', 2, fits(20))).toEqual(['Konvektomat Rational', 'iCombi']);
  });

  it('cuts what does not fit at the end of the last line with an ellipsis', () => {
    const lines = wrapName('Velká profesionální kuchyňská myčka nádobí s předmytím', 2, fits(20));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Velká profesionální');
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(lines[1]!.length).toBeLessThanOrEqual(20);
  });

  it('cuts a single word wider than the line with an ellipsis instead of splitting it', () => {
    expect(wrapName('Supercalifragilistic', 2, fits(10))).toEqual(['Supercali…']);
    expect(wrapName('Konvektomat 10 GN', 2, fits(9))).toEqual(['Konvekto…', '10 GN']);
  });

  it('honours a single line', () => {
    const lines = wrapName('Dlouhý název položky', 1, fits(10));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith('…')).toBe(true);
  });

  it('ignores extra whitespace and answers nothing for an empty name', () => {
    expect(wrapName('  Váha   malá ', 2, fits(20))).toEqual(['Váha malá']);
    expect(wrapName('   ', 2, fits(20))).toEqual([]);
  });
});

describe('breakId', () => {
  const fits = (n: number) => (text: string) => text.length <= n;

  it('breaks after hyphens, keeping them, so no piece of the ID is cut', () => {
    expect(breakId('INV-73-2023016', fits(8))).toEqual(['INV-73-', '2023016']);
    expect(breakId('INV-73-2023016', fits(10))).toEqual(['INV-73-', '2023016']);
    expect(breakId('INV-73-2023016', fits(14))).toEqual(['INV-73-2023016']);
  });

  it('splits inside a piece only when the piece alone is too wide, and drops nothing', () => {
    const lines = breakId('INV-73-2023016', fits(5));
    expect(lines.join('')).toBe('INV-73-2023016');
    expect(lines.every((line) => line.length <= 5)).toBe(true);
  });
});

describe('fitLabelText', () => {
  it('sets the ID at 11 pt when it fits, with the name under it', () => {
    const text = fitLabelText(measure, { id: 'INV-73-2023016', name: 'Notebook Dell' }, boxFor(20));
    expect(text).toMatchObject({ idLines: ['INV-73-2023016'], idSize: 11, nameLines: ['Notebook Dell'], nameSize: 9 });
  });

  it('shrinks the ID to the largest size that fits, never under 8 pt', () => {
    // 14 characters need 7 pt-widths per size point; the box holds 12 characters at 11 pt.
    const text = fitLabelText(measure, { id: 'INV-73-2023016', name: 'X' }, boxFor(12));
    expect(text.idLines).toEqual(['INV-73-2023016']);
    expect(text.idSize).toBeLessThan(11);
    expect(text.idSize).toBeGreaterThanOrEqual(8);
    expect(measure('INV-73-2023016', text.idSize, true)).toBeLessThanOrEqual(boxFor(12).width * MM);
    // And one step larger would not have fit.
    expect(measure('INV-73-2023016', text.idSize + 0.5, true)).toBeGreaterThan(boxFor(12).width * MM);
  });

  it('breaks an ID that does not fit even at 8 pt rather than abbreviating it, and sets the name at 8 pt', () => {
    const text = fitLabelText(measure, { id: 'INV-73-2023016', name: 'Notebook' }, boxFor(7));
    expect(text.idSize).toBe(8);
    expect(text.idLines).toEqual(['INV-73-', '2023016']);
    expect(text.idLines.join('')).toBe('INV-73-2023016');
    expect(text.nameSize).toBe(8);
  });

  it('gives the name two lines at most, and fewer when the box is not tall enough', () => {
    const name = 'Velká profesionální kuchyňská myčka nádobí';
    expect(fitLabelText(measure, { id: 'INV-1', name }, boxFor(14, 30)).nameLines).toHaveLength(2);
    // Room for the ID (4.6 mm) and one line of the name (3.8 mm) only.
    expect(fitLabelText(measure, { id: 'INV-1', name }, boxFor(14, 9)).nameLines).toHaveLength(1);
    expect(fitLabelText(measure, { id: 'INV-1', name }, boxFor(14, 5)).nameLines).toEqual([]);
  });

  it('truncates a long name with an ellipsis', () => {
    const { nameLines } = fitLabelText(
      measure,
      { id: 'INV-1', name: 'Extrémně dlouhý název položky, který se do dvou řádků nikdy nevejde' },
      boxFor(18),
    );
    expect(nameLines).toHaveLength(2);
    expect(nameLines[1]!.endsWith('…')).toBe(true);
  });
});
