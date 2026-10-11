import { describe, expect, it } from 'vitest';
import {
  cellOrigin,
  emptyOnLastPage,
  isQrTooSmall,
  isValidStartPosition,
  labelLayout,
  labelSize,
  pageCount,
  placement,
  qrSide,
  slotsPerPage,
} from '../src/features/labels/layout.ts';

const grid = { columns: 3, rows: 8 };

describe('label grid', () => {
  it('shares the page inside the 5 mm margin evenly, without gaps', () => {
    const size = labelSize(grid);
    expect(size.width).toBeCloseTo(66.667, 3);
    expect(size.height).toBeCloseTo(35.875, 3);
    expect(labelSize({ columns: 5, rows: 13 }).width).toBe(40);
    expect(slotsPerPage(grid)).toBe(24);
  });

  it('puts a cell where its row and column are', () => {
    expect(cellOrigin(grid, 0, 0)).toEqual({ x: 5, y: 5 });
    const last = cellOrigin(grid, 7, 2);
    expect(last.x + labelSize(grid).width).toBeCloseTo(205);
    expect(last.y + labelSize(grid).height).toBeCloseTo(292);
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
    expect(qr.width).toBeCloseTo(35.875 - 6, 3);
    expect(qr.height).toBe(qr.width);
    expect(text.x).toBeCloseTo(3 + qr.width + 2, 3);
    expect(text.x + text.width).toBeCloseTo(66.667 - 3, 3);
    expect(text.height).toBeCloseTo(29.875, 3);
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
    expect(qrSide(grid)).toBeCloseTo(29.875, 3);
    expect(isQrTooSmall(grid)).toBe(false);
    expect(isQrTooSmall({ columns: 5, rows: 13 })).toBe(false);
    expect(isQrTooSmall({ columns: 5, rows: 14 })).toBe(true);
    expect(isQrTooSmall({ columns: 6, rows: 16 })).toBe(true);
    expect(isQrTooSmall({ columns: 1, rows: 1 })).toBe(false);
  });
});
