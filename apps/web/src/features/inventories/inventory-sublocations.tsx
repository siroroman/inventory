import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { sectionTitleClass } from '@/components/section';
import { Progress, progressPercent } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { FigureGrid } from './inventory-summary';

/** How many of the run's locations are in each state (the groups of the overview). */
export type LocationCounts = { notStarted: number; inProgress: number; done: number };

/**
 * "Podlokality": how far the run is by location. The bar is the locations that are done out of all
 * of them, the figures say how many nobody has started, how many are under way and how many are
 * done. A run over one location (a shop) has nothing to divide it by, so nothing is shown for it.
 */
export function SubLocationsBox({ counts }: { counts: LocationCounts }) {
  const { t } = useTranslation();
  const titleId = useId();
  const total = counts.notStarted + counts.inProgress + counts.done;
  if (total <= 1) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className={cn(sectionTitleClass, 'pt-6 text-xl')}>
        {t('inventory.locations.title')}
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-semibold">
            {t('inventory.locations.progress', {
              done: counts.done,
              total,
              percent: progressPercent(counts.done, total),
            })}
          </p>
          <Progress value={counts.done} max={total} label={t('inventory.locations.progressLabel')} />
        </div>
        <FigureGrid
          className="grid-cols-2 md:grid-cols-3"
          figures={(['notStarted', 'inProgress', 'done'] as const).map((key) => ({
            key,
            label: t(`inventory.locations.figures.${key}`),
            value: counts[key],
          }))}
        />
      </div>
    </section>
  );
}
