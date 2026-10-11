import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';
import { locationLabelsQueryOptions } from './api';
import { ItemsStep } from './items-step';
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
 * a reload or a trip to another section loses nothing. Steps 3 and 4 are still to come.
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
  const canContinue =
    current === 1 ? location !== null : current === 2 ? listed.data !== undefined && withinLimit(rows.length) : false;

  const go = (next: number) => onNavigate({ step: next === 1 ? undefined : next });
  const choose = (next: ChosenLocation) => setSelection({ location: next, excluded: [], added: [] });

  return (
    <div className={desktop ? 'flex flex-col gap-5 px-8 pt-7 pb-8' : 'flex flex-col gap-5 px-4 pt-6 pb-6'}>
      <h2 className={desktop ? 'text-[28px] font-semibold' : 'text-2xl font-semibold'}>{t('labels.title')}</h2>
      <StepIndicator step={current} />

      <div className="max-w-3xl">
        {current === 1 && (
          <LocationStep location={location} needsConfirm={hasChoices(selection)} onChoose={choose} />
        )}
        {current === 2 && location && (
          <ItemsStep location={location} listed={listed} selection={selection} chosen={rows.length} onChange={setSelection} />
        )}
        {current === 3 && (
          <p className="text-muted-foreground">{t('labels.layout.placeholder')}</p>
        )}
        {current === 4 && (
          <p className="text-muted-foreground">{t('labels.download.placeholder')}</p>
        )}
      </div>

      <div className="flex max-w-3xl items-center justify-between gap-3 border-t pt-4">
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
  );
}
