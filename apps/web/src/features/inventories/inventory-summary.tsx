import type { InventoryCountsDto, InventoryLocationDto } from '@inventory/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** The four figures of a run or of one location of it. */
export type InventoryFigures = {
  /** Items of the list that were checked. */
  checked: number;
  /** Items of the list still to check (not marked missing). */
  unchecked: number;
  /** Items found elsewhere or added: they are not on the list. */
  extra: number;
  /** Items of the list marked missing when the run finished. */
  missing: number;
};

/** The figures of the whole run, from its counts. */
export const runFigures = ({ expected, checked, elsewhere, new: added, missing }: InventoryCountsDto): InventoryFigures => ({
  checked,
  unchecked: Math.max(expected - checked - missing, 0),
  extra: elsewhere + added,
  missing,
});

/** The figures of one location, from its numbers (they add up to the run's). */
export const locationFigures = ({ total, checked, extra, missing }: InventoryLocationDto): InventoryFigures => ({
  checked,
  unchecked: Math.max(total - checked - missing, 0),
  extra,
  missing,
});

/**
 * "Zkontrolováno · Nezkontrolováno · Nové · Chybí": what the progress bar's "84 / 128" is made of,
 * plus what is not on the list. The same four figures on the run's overview and on a checklist.
 * Chybí is 0 until the run is finished.
 */
export function InventorySummary({ figures }: { figures: InventoryFigures }) {
  const { t } = useTranslation();
  const items: { key: keyof InventoryFigures; className?: string }[] = [
    { key: 'checked' },
    { key: 'unchecked' },
    { key: 'extra' },
    { key: 'missing', className: figures.missing > 0 ? 'text-destructive' : undefined },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map(({ key, className }) => (
        <div key={key} className="flex flex-col rounded-md bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t(`inventory.summary.${key}`)}</dt>
          <dd className={cn('text-lg font-semibold', className)}>{figures[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
