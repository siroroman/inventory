import { describe, expect, it } from 'vitest';
import i18n from '../src/i18n/index.ts';
import { formatDate, formatFileSize, formatPrice, formatTime, formatTimestamp } from '../src/lib/format.ts';

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

describe('formatTimestamp', () => {
  it('shows the day of a moment in time the Czech way', () => {
    // Noon UTC is the same calendar day in every time zone from UTC-11 to UTC+11.
    expect(formatTimestamp('2026-10-02T12:00:00.000Z').replace(/\s/g, ' ')).toBe('2. 10. 2026');
  });
});

describe('formatPrice', () => {
  it.each([
    [0, '0 Kč'],
    [39440, '39 440 Kč'],
    [144902.5, '144 902,50 Kč'],
    [13064.25, '13 064,25 Kč'],
  ])('%s', (value, text) => {
    expect(formatPrice(value).replace(/\s/g, ' ')).toBe(text);
  });
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 kB'],
    [122_880, '120 kB'],
    [1024 * 1024 - 1, '1 MB'],
    [1024 * 1024 - 1024, '1023 kB'],
    [1024 * 1024, '1 MB'],
    [1_258_291, '1,2 MB'],
    [20 * 1024 * 1024, '20 MB'],
  ])('%s bytes', (bytes, text) => {
    expect(formatFileSize(bytes).replace(/\s/g, ' ')).toBe(text);
  });
});

describe('formatTime', () => {
  it('shows the time of day the Czech way, without a leading zero on the hour', () => {
    const local = new Date(2026, 9, 3, 9, 5).toISOString();
    expect(formatTime(local)).toBe('9:05');
    expect(formatTime(new Date(2026, 9, 3, 16, 30).toISOString())).toBe('16:30');
  });
});
