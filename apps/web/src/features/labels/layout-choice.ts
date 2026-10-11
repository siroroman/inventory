import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  isValidStartPosition,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
} from './layout.ts';

/** The sheet of step 3: columns, rows and the first free place on it (from 1). */
export type LayoutChoice = { columns: number; rows: number; startPosition: number };

export const defaultLayout: LayoutChoice = { columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS, startPosition: 1 };

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

const STORAGE_KEY = 'labels-layout';

/** What the tab remembers of the sheet; anything that does not look right is the default. */
export function loadLayout(): LayoutChoice {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<LayoutChoice> | null;
    if (!stored || !whole(stored.columns, MIN_COLUMNS, MAX_COLUMNS) || !whole(stored.rows, MIN_ROWS, MAX_ROWS)) {
      return defaultLayout;
    }
    const grid = { columns: stored.columns, rows: stored.rows };
    const startPosition =
      typeof stored.startPosition === 'number' && isValidStartPosition(grid, stored.startPosition) ? stored.startPosition : 1;
    return { ...grid, startPosition };
  } catch {
    return defaultLayout;
  }
}

export function saveLayout(layout: LayoutChoice): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Private mode or full storage: the wizard forgets the sheet on reload, nothing else.
  }
}
