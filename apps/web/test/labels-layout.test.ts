import { describe, expect, it } from 'vitest';
import {
  cellOrigin,
  DEFAULT_TAPE,
  emptyOnLastPage,
  isQrTooSmall,
  isValidMargins,
  isTapeQrTooSmall,
  isValidStartPosition,
  isValidTapeSize,
  labelLayout,
  labelSize,
  MAX_LABEL_MM,
  MIN_LABEL_MM,
  pageCount,
  placement,
  qrSide,
  qrSideOf,
  slotsPerPage,
} from '../src/features/labels/layout.ts';

const grid = { columns: 3, rows: 8 };

describe('label grid', () => {
  it('shares the page inside the default margins (8, 21, 8, 21 mm) evenly, without gaps', () => {
    const size = labelSize(grid);
    expect(size.width).toBeCloseTo(64.667, 3);
    expect(size.height).toBeCloseTo(31.875, 3);
    expect(labelSize({ columns: 5, rows: 13 }).width).toBeCloseTo(38.8, 3);
    expect(slotsPerPage(grid)).toBe(24);
  });

  it('puts a cell where its row and column are', () => {
    expect(cellOrigin(grid, 0, 0)).toEqual({ x: 8, y: 21 });
    const last = cellOrigin(grid, 7, 2);
    expect(last.x + labelSize(grid).width).toBeCloseTo(202);
    expect(last.y + labelSize(grid).height).toBeCloseTo(276);
  });

  it('counts positions from 1, left to right, top to bottom, and carries over to the next sheet', () => {
    expect(placement(grid, 1, 0)).toEqual({ page: 0, row: 0, column: 0 });
    expect(placement(grid, 1, 4)).toEqual({ page: 0, row: 1, column: 1 });
    expect(placement(grid, 5, 0)).toEqual({ page: 0, row: 1, column: 1 });
    expect(placement(grid, 24, 0)).toEqual({ page: 0, row: 7, column: 2 });
    expect(placement(grid, 24, 1)).toEqual({ page: 1, row: 0, column: 0 });
    expect(placement(grid, 1, 48)).toEqual({ page: 2, row: 0, column: 0 });
  });

  it('counts the sheets and the places left empty on the last one', () => {
    expect(pageCount(grid, 1, 0)).toBe(0);
    expect(pageCount(grid, 1, 1)).toBe(1);
    expect(pageCount(grid, 1, 24)).toBe(1);
    expect(pageCount(grid, 1, 25)).toBe(2);
    // 118 labels: 4 full sheets of 24 and 22 on the fifth.
    expect(pageCount(grid, 1, 118)).toBe(5);
    expect(emptyOnLastPage(grid, 1, 118)).toBe(2);
    expect(emptyOnLastPage(grid, 1, 24)).toBe(0);
    // Starting at the 6th place, the same 24 labels spill onto a second sheet.
    expect(pageCount(grid, 6, 24)).toBe(2);
    expect(emptyOnLastPage(grid, 6, 24)).toBe(19);
  });

  it('accepts only whole places on the sheet as the start position', () => {
    expect(isValidStartPosition(grid, 1)).toBe(true);
    expect(isValidStartPosition(grid, 24)).toBe(true);
    expect(isValidStartPosition(grid, 0)).toBe(false);
    expect(isValidStartPosition(grid, 25)).toBe(false);
    expect(isValidStartPosition(grid, 2.5)).toBe(false);
  });
});

describe('label layout', () => {
  it('puts the QR on the left of a landscape label, as high as the label less the inner margins', () => {
    const { stacked, qr, text } = labelLayout(labelSize(grid));
    expect(stacked).toBe(false);
    expect(qr.x).toBe(3);
    expect(qr.y).toBe(3);
    expect(qr.width).toBeCloseTo(31.875 - 6, 3);
    expect(qr.height).toBe(qr.width);
    expect(text.x).toBeCloseTo(3 + qr.width + 2, 3);
    expect(text.x + text.width).toBeCloseTo(64.667 - 3, 3);
    expect(text.height).toBeCloseTo(25.875, 3);
  });

  it('stacks a portrait-ish label: QR on top and centred, text below', () => {
    // 40 x 60 mm: width < 1.3 x height.
    const { stacked, qr, text } = labelLayout({ width: 40, height: 60 });
    expect(stacked).toBe(true);
    expect(qr.width).toBe(34);
    expect(qr.x).toBe(3);
    expect(text.y).toBeGreaterThan(qr.y + qr.width);
    expect(text.y + text.height).toBeCloseTo(57, 3);
    expect(text.width).toBe(34);
  });

  it('keeps the text room under a stacked QR code when the label is not tall enough for a wide one', () => {
    const { qr } = labelLayout({ width: 36, height: 30 });
    expect(qr.width).toBe(30 - 6 - 11);
  });

  it('warns when the QR side is under 15 mm', () => {
    expect(qrSide(grid)).toBeCloseTo(25.875, 3);
    expect(isQrTooSmall(grid)).toBe(false);
    expect(isQrTooSmall({ columns: 5, rows: 12 })).toBe(false);
    expect(isQrTooSmall({ columns: 5, rows: 13 })).toBe(true);
    expect(isQrTooSmall({ columns: 6, rows: 16 })).toBe(true);
    expect(isQrTooSmall({ columns: 1, rows: 1 })).toBe(false);
  });
});

describe('label printer sizes', () => {
  it('fits a QR code of 18 mm on the default 50 x 24 mm label of a 24 mm tape', () => {
    expect(DEFAULT_TAPE).toEqual({ width: 50, height: 24 });
    expect(qrSideOf(DEFAULT_TAPE)).toBe(18);
    expect(isTapeQrTooSmall(DEFAULT_TAPE)).toBe(false);
  });

  it('warns when the tape is too narrow for a readable QR code', () => {
    // A 12 mm tape leaves 6 mm for the code.
    expect(isTapeQrTooSmall({ width: 40, height: 12 })).toBe(true);
    expect(isTapeQrTooSmall({ width: 40, height: 21 })).toBe(false);
  });

  it('accepts sides from 10 to 100 mm only', () => {
    expect(isValidTapeSize({ width: MIN_LABEL_MM, height: MAX_LABEL_MM })).toBe(true);
    expect(isValidTapeSize({ width: 9.9, height: 24 })).toBe(false);
    expect(isValidTapeSize({ width: 50, height: 100.1 })).toBe(false);
    expect(isValidTapeSize({ width: Number.NaN, height: 24 })).toBe(false);
  });
});

describe('page margins', () => {
  const margins = { left: 10, top: 12, right: 6, bottom: 20 };

  it('shares the page inside the given margins and starts the grid at the left and top ones', () => {
    const custom = { columns: 2, rows: 5, margins };
    expect(labelSize(custom)).toEqual({ width: 97, height: 53 });
    expect(cellOrigin(custom, 0, 0)).toEqual({ x: 10, y: 12 });
    const last = cellOrigin(custom, 4, 1);
    expect(last.x + 97).toBeCloseTo(210 - 6);
    expect(last.y + 53).toBeCloseTo(297 - 20);
  });

  it('accepts whole millimetres from 0 to 50 on every side', () => {
    expect(isValidMargins(margins)).toBe(true);
    expect(isValidMargins({ ...margins, left: 0 })).toBe(true);
    expect(isValidMargins({ ...margins, top: 51 })).toBe(false);
    expect(isValidMargins({ ...margins, right: -1 })).toBe(false);
    expect(isValidMargins({ ...margins, bottom: 2.5 })).toBe(false);
    // Anything that is not four numbers, as the browser may remember it.
    for (const bad of [{}, [], 5, 'x', null, undefined, { left: 8, top: 21, right: 8 }, { ...margins, left: '8' }]) {
      expect(isValidMargins(bad)).toBe(false);
    }
  });
});
