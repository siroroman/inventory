import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  DEFAULT_TAPE,
  isValidStartPosition,
  isValidTapeSize,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
} from './layout.ts';

/** What the labels are printed on: A4 sheets of stickers, or a label printer (one label per page). */
export type LabelFormat = 'sheet' | 'tape';

/**
 * The layout of step 3. The grid and the label printer's size are both kept, so switching the
 * format back and forth loses neither. `startPosition` is the first free place of a partly used A4 sheet.
 */
export type LayoutChoice = {
  format: LabelFormat;
  columns: number;
  rows: number;
  startPosition: number;
  /** Label printer: the label's size in millimetres (the height is the width of the tape). */
  width: number;
  height: number;
};

export const defaultLayout: LayoutChoice = {
  format: 'sheet',
  columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS,
  startPosition: 1,
  ...DEFAULT_TAPE,
};

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

// The printer and the format belong to the device, so they stay for good; a place on a sheet of
// stickers is only true for the sheet in hand, so it goes with the tab.
const SETTINGS_KEY = 'labels-layout';
const START_KEY = 'labels-start';

// The storage comes as a getter: merely naming `localStorage` throws when site data is blocked.
const read = (storage: () => Storage, key: string): unknown => {
  try {
    return JSON.parse(storage().getItem(key) ?? 'null');
  } catch {
    return null;
  }
};

/** What the device remembers of the layout; anything that does not look right is the default. */
export function loadLayout(): LayoutChoice {
  const stored = read(() => localStorage, SETTINGS_KEY) as Partial<LayoutChoice> | null;
  if (!stored || typeof stored !== 'object') return defaultLayout;

  const columns = whole(stored.columns, MIN_COLUMNS, MAX_COLUMNS) ? stored.columns : defaultLayout.columns;
  const rows = whole(stored.rows, MIN_ROWS, MAX_ROWS) ? stored.rows : defaultLayout.rows;
  const tape = { width: Number(stored.width), height: Number(stored.height) };
  const size = isValidTapeSize(tape) ? tape : DEFAULT_TAPE;

  const start = read(() => sessionStorage, START_KEY);
  const startPosition = typeof start === 'number' && isValidStartPosition({ columns, rows }, start) ? start : 1;
  return { format: stored.format === 'tape' ? 'tape' : 'sheet', columns, rows, startPosition, ...size };
}

export function saveLayout({ startPosition, ...settings }: LayoutChoice): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    sessionStorage.setItem(START_KEY, JSON.stringify(startPosition));
  } catch {
    // Private mode or full storage: the wizard forgets the layout on reload, nothing else.
  }
}
