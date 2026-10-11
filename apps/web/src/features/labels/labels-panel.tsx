import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';
import { locationLabelsQueryOptions } from './api';
import { DownloadStep } from './download-step';
import { ItemsStep } from './items-step';
import { defaultLayout, type LayoutChoice, loadLayout, saveLayout } from './layout-choice';
import { LayoutStep } from './layout-step';
import { LocationStep } from './location-step';
import {
  type ChosenLocation,
  chosenRows,
  emptySelection,
  hasChoices,
  loadSelection,
  saveSelection,
  type Selection,
  withinLimit,
} from './selection';
import { STEP_COUNT, StepIndicator } from './step-indicator';

type Props = {
  /** From the URL: 1 to 4, missing = 1. */
  step: number;
  /** From the URL: the location chosen in step 1. */
  locationId?: string;
  /** Moves in the URL; `replace` for a correction that is not a step of the user's. */
  onNavigate: (to: { step?: number; locationId?: string }, replace?: boolean) => void;
};

/**
 * The Štítky section: a wizard in four steps that ends in a PDF of QR labels (SPEC §9.4.12). The
 * step and the location are in the URL; what was chosen is kept in the tab's `sessionStorage`, so
 * a reload or a trip to another section loses nothing.
 */
export function LabelsPanel({ step, locationId, onNavigate }: Props) {
  const { t } = useTranslation();
  const desktop = useMediaQuery(desktopScreen);
  const [selection, setSelection] = useState<Selection>(() => {
    const stored = loadSelection();
    // A link to another location than the one remembered is a fresh start.
    return locationId && stored.location?.id !== locationId ? emptySelection : stored;
  });
  useEffect(() => saveSelection(selection), [selection]);
  const [layout, setLayout] = useState<LayoutChoice>(loadLayout);
  useEffect(() => saveLayout(layout), [layout]);

  const location = selection.location;
  const requested = Math.min(Math.max(1, Math.trunc(step) || 1), STEP_COUNT);
  // Later steps need a location; without one (a link, a cleared tab) the wizard starts over.
  const current = requested >= 2 && !location ? 1 : requested;

  // The URL follows the state: the location's id, and the step when it was corrected.
  const navigated = useRef(onNavigate);
  navigated.current = onNavigate;
  useEffect(() => {
    if (locationId !== location?.id) navigated.current({ locationId: location?.id }, true);
    else if (current !== requested) navigated.current({ step: current === 1 ? undefined : current }, true);
  }, [locationId, location?.id, current, requested]);

  const listed = useQuery({ ...locationLabelsQueryOptions(location?.id ?? ''), enabled: location !== null && current >= 2 });
  const rows = chosenRows(listed.data?.items ?? [], selection);
  const loaded = listed.data !== undefined;
  const canContinue =
    current === 1 ? location !== null : current === 2 ? loaded && withinLimit(rows.length) : current === 3 && loaded;
  // Steps 3 and 4 are for a list that can be printed; if it cannot (everything unchecked on another
  // device, items archived since), the wizard goes back to where it is fixed.
  useEffect(() => {
    if (current >= 3 && loaded && !withinLimit(rows.length)) navigated.current({ step: 2 }, true);
  }, [current, loaded, rows.length]);

  // The furthest step the user has been to; its number in the indicator is a link back to it. The
  // steps depend on the location, so another one starts over, and so does a list that cannot be printed.
  const [reached, setReached] = useState(current);
  useEffect(() => setReached((furthest) => Math.max(furthest, current)), [current]);
  const printable = !loaded || withinLimit(rows.length);
  const linkable = !location ? 1 : printable ? reached : Math.min(reached, 2);

  const go = (next: number) => onNavigate({ step: next === 1 ? undefined : next });
  const choose = (next: ChosenLocation) => {
    setSelection({ location: next, excluded: [], added: [] });
    setReached(1);
  };
  // "Vytvořit nové štítky": nothing chosen, the sheet is used up so it starts at its first place again.
  const restart = () => {
    setSelection(emptySelection);
    setReached(1);
    setLayout({ ...layout, startPosition: defaultLayout.startPosition });
    onNavigate({ step: undefined, locationId: undefined });
  };

  return (
    <div className={desktop ? 'px-8 pt-7 pb-8' : 'px-4 pt-6 pb-6'}>
      {/* One column, centred in the page: the wizard has no list to fill the width. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <h2 className={desktop ? 'text-[28px] font-semibold' : 'text-2xl font-semibold'}>{t('labels.title')}</h2>
        <StepIndicator step={current} reached={linkable} canContinue={canContinue && current < STEP_COUNT} onSelect={go} />

        <div>
          {current === 1 && (
            <LocationStep location={location} needsConfirm={hasChoices(selection)} onChoose={choose} />
          )}
          {current === 2 && location && (
            <ItemsStep location={location} listed={listed} selection={selection} chosen={rows.length} onChange={setSelection} />
          )}
          {current >= 3 && location && !loaded && !listed.isError && (
            <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {current >= 3 && location && listed.isError && (
            <ItemsStep location={location} listed={listed} selection={selection} chosen={rows.length} onChange={setSelection} />
          )}
          {current === 3 && loaded && <LayoutStep items={rows} layout={layout} onChange={setLayout} />}
          {current === 4 && location && loaded && (
            <DownloadStep location={location} items={rows} layout={layout} onRestart={restart} />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" disabled={current === 1} onClick={() => go(current - 1)}>
            {t('labels.back')}
          </Button>
          {current < STEP_COUNT && (
            <Button disabled={!canContinue} onClick={() => go(current + 1)}>
              {t('labels.next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
