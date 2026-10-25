import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLayout, loadLayout, saveLayout } from '../src/features/labels/layout-choice.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the remembered label layout', () => {
  it('is A4 3 x 8 and a 50 x 24 mm label printer when nothing is remembered', () => {
    expect(loadLayout()).toEqual({ format: 'sheet', columns: 3, rows: 8, startPosition: 1, width: 50, height: 24 });
    expect(loadLayout()).toEqual(defaultLayout);
  });

  it('keeps the format, the grid and the label size on the device, the place on the sheet for the tab', () => {
    saveLayout({ format: 'tape', columns: 4, rows: 6, startPosition: 7, width: 40, height: 12 });
    expect(JSON.parse(localStorage.getItem('labels-layout')!)).toEqual({
      format: 'tape',
      columns: 4,
      rows: 6,
      width: 40,
      height: 12,
    });
    expect(JSON.parse(sessionStorage.getItem('labels-start')!)).toBe(7);
    expect(loadLayout()).toEqual({ format: 'tape', columns: 4, rows: 6, startPosition: 7, width: 40, height: 12 });

    // A new tab on the same device has the format but starts the sheet at its first place.
    sessionStorage.clear();
    expect(loadLayout()).toMatchObject({ format: 'tape', columns: 4, rows: 6, startPosition: 1 });
  });

  it('replaces whatever does not look right, field by field', () => {
    localStorage.setItem(
      'labels-layout',
      JSON.stringify({ format: 'printer', columns: 9, rows: 6, width: 500, height: 'x' }),
    );
    sessionStorage.setItem('labels-start', JSON.stringify(99));
    expect(loadLayout()).toEqual({ format: 'sheet', columns: 3, rows: 6, startPosition: 1, width: 50, height: 24 });
  });

  it('survives broken or missing storage', () => {
    localStorage.setItem('labels-layout', '{not json');
    expect(loadLayout()).toEqual(defaultLayout);
    localStorage.setItem('labels-layout', '"tape"');
    expect(loadLayout()).toEqual(defaultLayout);
  });

  it('falls back to the default when the browser blocks storage altogether', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked);
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked);
    expect(loadLayout()).toEqual(defaultLayout);
    expect(() => saveLayout(defaultLayout)).not.toThrow();
    vi.restoreAllMocks();
  });
});
