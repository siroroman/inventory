import type { InventoryRowDto } from '@inventory/shared';
import { matchesWords } from '@/lib/search';

const collator = new Intl.Collator('cs');

const byName = (a: InventoryRowDto, b: InventoryRowDto) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);

/** How many checked rows are listed before "… a dalších N zkontrolovaných". */
export const recentCheckedCount = 5;

export type ChecklistGroups = { unchecked: InventoryRowDto[]; checked: InventoryRowDto[] };

/**
 * Splits the rows of a location into the two groups of the checklist, each in the order it is
 * shown: the unchecked by name in Czech order, the checked with the newest check first. `q` keeps
 * the rows whose name or ID contains each of its words.
 */
export function groupRows(rows: InventoryRowDto[], q: string): ChecklistGroups {
  const matching = rows.filter((row) => matchesWords([row.name, row.code], q));
  return {
    unchecked: matching.filter((row) => !row.checkedAt).sort(byName),
    checked: matching
      .filter((row) => row.checkedAt)
      .sort((a, b) => b.checkedAt!.localeCompare(a.checkedAt!) || byName(a, b)),
  };
}
