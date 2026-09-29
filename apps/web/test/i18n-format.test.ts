import { describe, expect, it } from 'vitest';
import i18n from '../src/i18n/index.ts';
import { formatDate } from '../src/lib/format.ts';

describe('Czech plurals', () => {
  it.each([
    [0, '0 položek'],
    [1, '1 položka'],
    [2, '2 položky'],
    [4, '4 položky'],
    [5, '5 položek'],
    [11, '11 položek'],
    [21, '21 položek'],
  ])('%s', (count, text) => {
    expect(i18n.t('common.itemCount', { count }).replace(/ /g, ' ')).toBe(text);
  });
});

describe('formatDate', () => {
  it('formats a date-only value the Czech way, without shifting the day', () => {
    expect(formatDate('2026-09-27').replace(/ /g, ' ')).toBe('27. 9. 2026');
    expect(formatDate('2026-01-01').replace(/ /g, ' ')).toBe('1. 1. 2026');
  });
});
