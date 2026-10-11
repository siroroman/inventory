import type { InventoryCountsDto, InventoryLocationDto } from '@inventory/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** The four figures of a run or of one location of it. */
export type InventoryFigures = {
  /** Items of the list that were checked. */
  checked: number;
  /** Items of the list still to check (not flagged as missing). */
  unchecked: number;
  /** Items found elsewhere or added: they are not on the list. */
  extra: number;
  /** Items of the list flagged as missing. */
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
 * The progress bar's "10 / 10": everything the screen lists (the four figures added up) and how much
 * of it is settled, that is all but what is still to check. Found, added and flagged items count as
 * settled, so a run with nothing left unchecked reads 100 %.
 */
export const progressOf = ({ checked, unchecked, extra, missing }: InventoryFigures) => ({
  done: checked + extra + missing,
  total: checked + unchecked + extra + missing,
});

/** Small boxes, each a label over a number: the figures under a progress bar. */
export function FigureGrid({
  figures,
  className,
}: {
  figures: { key: string; label: string; value: number; className?: string }[];
  className: string;
}) {
  return (
    <dl className={cn('grid gap-2', className)}>
      {figures.map(({ key, label, value, className: valueClass }) => (
        <div key={key} className="flex flex-col rounded-md bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={cn('text-lg font-semibold', valueClass)}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Zkontrolováno · Nezkontrolováno · Nové · Chybí": what the progress bar's "10 / 10" is made of.
 * The same four figures on the run's overview and on a checklist. Chybí is what people flagged as
 * missing; it is 0 until somebody does.
 */
export function InventorySummary({ figures }: { figures: InventoryFigures }) {
  const { t } = useTranslation();
  const keys: (keyof InventoryFigures)[] = ['checked', 'unchecked', 'extra', 'missing'];
  return (
    <FigureGrid
      className="grid-cols-2 md:grid-cols-4"
      figures={keys.map((key) => ({
        key,
        label: t(`inventory.summary.${key}`),
        value: figures[key],
        className: key === 'missing' && figures.missing > 0 ? 'text-destructive' : undefined,
      }))}
    />
  );
}
