import type { InventoryRowDto } from '@inventory/shared';
import { matchesId, matchesWords } from '@/lib/search';

const collator = new Intl.Collator('cs');

const byName = (a: InventoryRowDto, b: InventoryRowDto) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);

export type ChecklistGroups = {
  /** Items of the list that are not checked yet and not flagged as missing. */
  unchecked: InventoryRowDto[];
  /** Items of the list a person flagged as missing: looked for and not there. */
  missing: InventoryRowDto[];
  /** Items of the list that are checked. */
  checked: InventoryRowDto[];
  /** Items found elsewhere or added during the run (they are not on the list). */
  added: InventoryRowDto[];
};

const newestFirst = (a: InventoryRowDto, b: InventoryRowDto) =>
  b.checkedAt!.localeCompare(a.checkedAt!) || byName(a, b);

const idsOf = (row: InventoryRowDto) => [row.code, ...row.externalIds.map((e) => e.value)];

/**
 * The rows `q` looks for. An ID read off a label or a sticker (ours, the electrician's "S 129", the
 * accountant's "73-2023016"; spaces ignored, so "S129" too) finds just the items that have it, not
 * also a "Stůl" whose ID has "129" in it. Anything else keeps the rows that have each of its words
 * in the name or one of the IDs.
 */
export function matchingRows(rows: InventoryRowDto[], q: string): InventoryRowDto[] {
  const byId = rows.filter((row) => matchesId(idsOf(row), q));
  return byId.length > 0 ? byId : rows.filter((row) => matchesWords([row.name, ...idsOf(row)], q));
}

/**
 * Splits the rows of a location into the four groups of the checklist, each in the order it is
 * shown: the unchecked and the missing by name in Czech order, the checked and the added with the
 * newest check first. The added rows are those that were not on the list (found elsewhere, or
 * created during the run), so the groups add up to the figures of the summary. `q` keeps the rows
 * it looks for (`matchingRows`).
 */
export function groupRows(rows: InventoryRowDto[], q: string): ChecklistGroups {
  const matching = matchingRows(rows, q);
  const listed = matching.filter((row) => row.kind === 'expected');
  return {
    unchecked: listed.filter((row) => !row.checkedAt && !row.missing).sort(byName),
    missing: listed.filter((row) => !row.checkedAt && row.missing).sort(byName),
    checked: listed.filter((row) => row.checkedAt).sort(newestFirst),
    // An unchecked found row is not shown by the API; if one is still here it is only on its way out.
    added: matching.filter((row) => row.kind !== 'expected' && row.checkedAt).sort(newestFirst),
  };
}
