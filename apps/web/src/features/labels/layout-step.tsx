import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { loadPreviewFonts } from './fonts';
import { clamp, type LayoutChoice } from './layout-choice';
import {
  emptyOnLastPage,
  isQrTooSmall,
  labelSize,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
  PAGE_MARGIN_MM,
  pageCount,
  slotsPerPage,
} from './layout';
import { SheetPreview } from './sheet-preview';
import type { LabelRow } from './selection';
import { Stepper } from './stepper';

type Props = {
  items: LabelRow[];
  layout: LayoutChoice;
  onChange: (layout: LayoutChoice) => void;
};

const oneDecimal = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Step 3: the grid of the sheet, where to start on a partly used one, and the sheet as it will print. */
export function LayoutStep({ items, layout, onChange }: Props) {
  const { t } = useTranslation();
  const grid = { columns: layout.columns, rows: layout.rows };
  const size = labelSize(grid);
  const sheets = pageCount(grid, layout.startPosition, items.length);
  const empty = emptyOnLastPage(grid, layout.startPosition, items.length);
  const [page, setPage] = useState(0);
  const shownPage = Math.min(page, Math.max(0, sheets - 1));

  // The preview sets its text in the PDF's font once it has been fetched, then draws again.
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadPreviewFonts().then(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // A new grid makes the old position meaningless, so it starts again at the first place.
  const setGrid = (next: Partial<typeof grid>) => onChange({ ...layout, ...next, startPosition: 1 });

  return (
    <section aria-labelledby="labels-step-heading" className="flex flex-col gap-5">
      <h3 id="labels-step-heading" className="text-lg font-semibold">
        {t('labels.layout.heading')}
      </h3>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-5">
          <p className="w-fit rounded-full border bg-muted px-3 py-1 text-sm font-medium">{t('labels.layout.format')}</p>

          <div className="flex flex-wrap gap-6">
            <Stepper
              label={t('labels.layout.columns')}
              value={layout.columns}
              min={MIN_COLUMNS}
              max={MAX_COLUMNS}
              onChange={(columns) => setGrid({ columns })}
            />
            <Stepper
              label={t('labels.layout.rows')}
              value={layout.rows}
              min={MIN_ROWS}
              max={MAX_ROWS}
              onChange={(rows) => setGrid({ rows })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {t('labels.layout.labelSize', {
                width: oneDecimal.format(size.width),
                height: oneDecimal.format(size.height),
              })}
            </p>
            <p className="text-sm text-muted-foreground">{t('labels.layout.margin', { mm: PAGE_MARGIN_MM })}</p>
          </div>

          {isQrTooSmall(grid) && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('labels.layout.tooSmall')}
            </p>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('labels.layout.startPosition')}</legend>
            <p className="text-sm text-muted-foreground">{t('labels.layout.startHint')}</p>
            <div
              className="grid max-w-xs gap-1"
              style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: slotsPerPage(grid) }, (_, slot) => {
                const position = slot + 1;
                const used = position < layout.startPosition;
                const chosen = position === layout.startPosition;
                return (
                  <button
                    key={position}
                    type="button"
                    aria-pressed={chosen}
                    aria-label={t('labels.layout.position', { position })}
                    onClick={() => onChange({ ...layout, startPosition: clamp(position, 1, slotsPerPage(grid)) })}
                    className={cn(
                      'flex min-h-9 items-center justify-center rounded-sm border text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      chosen && 'border-primary bg-primary text-primary-foreground',
                      used && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,var(--color-border)_4px,var(--color-border)_5px)] text-muted-foreground',
                      !used && !chosen && 'bg-card hover:bg-accent',
                    )}
                  >
                    {position}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <p role="status" className="font-medium">
            {t('labels.layout.labelCount', { count: items.length })} · {t('labels.layout.sheetCount', { count: sheets })}
            {empty > 0 && <> · {t('labels.layout.emptyOnLast', { count: empty })}</>}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <SheetPreview items={items} grid={grid} startPosition={layout.startPosition} page={shownPage} />
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t('labels.layout.previousSheet')}
              disabled={shownPage === 0}
              onClick={() => setPage(shownPage - 1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <p className="text-sm">{t('labels.layout.sheetOf', { page: shownPage + 1, total: sheets })}</p>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('labels.layout.nextSheet')}
              disabled={shownPage >= sheets - 1}
              onClick={() => setPage(shownPage + 1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
