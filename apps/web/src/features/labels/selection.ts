import { MAX_LABELS } from '@inventory/shared';

/** What the wizard needs of an item: the QR holds `code`, the text shows it and `name`; `path` is the location. */
export type LabelRow = { id: string; code: string; name: string; path: string };
/** An item put on the list by hand; it can be unchecked without being removed. */
export type AddedRow = LabelRow & { checked: boolean };
/** The location chosen in step 1; `path` is the whole path, itself last. */
export type ChosenLocation = { id: string; code: string; name: string; path: string; itemCount: number };

/**
 * The choices of steps 1 and 2. Every item of the location is chosen unless it is in `excluded`,
 * so a new item of the location is chosen without the user doing anything.
 */
export type Selection = { location: ChosenLocation | null; excluded: string[]; added: AddedRow[] };

export const emptySelection: Selection = { location: null, excluded: [], added: [] };

/** The items that will get a label, in list order: the location's, then the ones added by hand. */
export function chosenRows(listed: LabelRow[], selection: Selection): LabelRow[] {
  const excluded = new Set(selection.excluded);
  const seen = new Set<string>();
  return [...listed.filter((row) => !excluded.has(row.id)), ...selection.added.filter((row) => row.checked)].filter(
    (row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    },
  );
}

export const withinLimit = (count: number) => count >= 1 && count <= MAX_LABELS;

/** Whether the user has done anything in step 2 that changing the location would throw away. */
export const hasChoices = (selection: Selection) => selection.excluded.length > 0 || selection.added.length > 0;

/** An item's place below the chosen location ("Přízemí › Kuchyně"); "" for the location itself. */
export function pathBelow(rowPath: string, locationPath: string): string {
  if (rowPath === locationPath) return '';
  return rowPath.startsWith(`${locationPath} › `) ? rowPath.slice(locationPath.length + 3) : rowPath;
}

const STORAGE_KEY = 'labels-wizard';

const isString = (value: unknown): value is string => typeof value === 'string';
const isRow = (value: unknown): value is LabelRow =>
  typeof value === 'object' &&
  value !== null &&
  isString((value as LabelRow).id) &&
  isString((value as LabelRow).code) &&
  isString((value as LabelRow).name) &&
  isString((value as LabelRow).path);

/** What the tab remembers while the browser tab lives; anything that does not look right is dropped. */
export function loadSelection(): Selection {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return emptySelection;
    const { location, excluded, added } = stored as Record<string, unknown>;
    const chosen = location as ChosenLocation | null;
    const validLocation =
      chosen !== null &&
      typeof chosen === 'object' &&
      isString(chosen.id) &&
      isString(chosen.code) &&
      isString(chosen.name) &&
      isString(chosen.path) &&
      typeof chosen.itemCount === 'number';
    if (!validLocation) return emptySelection;
    return {
      location: chosen,
      excluded: Array.isArray(excluded) ? excluded.filter(isString) : [],
      added: Array.isArray(added)
        ? added.filter(isRow).map((row) => ({ ...row, checked: (row as AddedRow).checked !== false }))
        : [],
    };
  } catch {
    return emptySelection;
  }
}

export function saveSelection(selection: Selection): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Private mode or full storage: the wizard still works, it just forgets on reload.
  }
}
