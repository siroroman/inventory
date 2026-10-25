import { ChevronLeft, ChevronRight, Maximize2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { loadPreviewFonts } from './fonts';
import type { LabelFormat, LayoutChoice } from './layout-choice';
import {
  emptyOnLastPage,
  isQrTooSmall,
  isTapeQrTooSmall,
  labelSize,
  MAX_COLUMNS,
  MAX_LABEL_MM,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_LABEL_MM,
  MIN_ROWS,
  PAGE_MARGIN_MM,
  pageCount,
  slotsPerPage,
} from './layout';
import { SheetPreview } from './sheet-preview';
import type { LabelRow } from './selection';
import { Stepper } from './stepper';
import { TapePreview } from './tape-preview';
import { cn } from '@/lib/utils';

type Props = {
  items: LabelRow[];
  layout: LayoutChoice;
  onChange: (layout: LayoutChoice) => void;
};

const oneDecimal = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const FORMATS: LabelFormat[] = ['sheet', 'tape'];

/**
 * Step 3: A4 sheets of stickers (the grid, the place to start from on a partly used one, the sheet as
 * it will print) or a label printer (the size of one label, each label a page of its own).
 */
export function LayoutStep({ items, layout, onChange }: Props) {
  const { t } = useTranslation();
  const tape = layout.format === 'tape';
  const grid = { columns: layout.columns, rows: layout.rows };
  const size = labelSize(grid);
  const tapeSize = { width: layout.width, height: layout.height };
  // What the preview pages through: the sheets of an A4 printer, the labels of a label printer.
  const sheets = tape ? items.length : pageCount(grid, layout.startPosition, items.length);
  const empty = emptyOnLastPage(grid, layout.startPosition, items.length);
  const tooSmall = tape ? isTapeQrTooSmall(tapeSize) : isQrTooSmall(grid);
  const [page, setPage] = useState(0);
  const shownPage = Math.min(page, Math.max(0, sheets - 1));
  // The sheet at the size of the screen, to check the text on the labels.
  const [enlarged, setEnlarged] = useState(false);

  // The preview sets its text in the PDF's font once it has been fetched, then draws again.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadPreviewFonts().then(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // A new grid makes the old position meaningless, so it starts again at the first place.
  const setGrid = (next: Partial<typeof grid>) => onChange({ ...layout, ...next, startPosition: 1 });

  const pager = (
    <div className="mx-auto flex w-full max-w-sm items-center justify-between gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label={t(tape ? 'labels.layout.previousLabel' : 'labels.layout.previousSheet')}
        disabled={shownPage === 0}
        onClick={() => setPage(shownPage - 1)}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <p className="text-sm">
        {t(tape ? 'labels.layout.labelOf' : 'labels.layout.sheetOf', { page: shownPage + 1, total: sheets })}
      </p>
      <Button
        variant="outline"
        size="icon"
        aria-label={t(tape ? 'labels.layout.nextLabel' : 'labels.layout.nextSheet')}
        disabled={shownPage >= sheets - 1}
        onClick={() => setPage(shownPage + 1)}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );

  return (
    <section aria-labelledby="labels-step-heading" className="flex flex-col gap-5">
      <h3 id="labels-step-heading" className="text-lg font-semibold">
        {t('labels.layout.heading')}
      </h3>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('labels.layout.formatLegend')}</legend>
            <div className="flex flex-wrap gap-3">
              {FORMATS.map((format) => (
                <label key={format} className="cursor-pointer">
                  <input
                    type="radio"
                    name="labels-format"
                    className="peer sr-only"
                    checked={layout.format === format}
                    onChange={() => {
                      setPage(0);
                      onChange({ ...layout, format });
                    }}
                  />
                  <span
                    className={cn(
                      'flex min-h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium',
                      'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
                      'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
                    )}
                  >
                    {t(`labels.layout.format_${format}`)}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{t(`labels.layout.formatInfo_${layout.format}`)}</p>
          </fieldset>

          {tape ? (
            <>
              <div className="flex flex-wrap gap-6">
                <Stepper
                  label={t('labels.layout.tapeWidth')}
                  value={layout.width}
                  min={MIN_LABEL_MM}
                  max={MAX_LABEL_MM}
                  onChange={(width) => onChange({ ...layout, width })}
                />
                <Stepper
                  label={t('labels.layout.tapeHeight')}
                  value={layout.height}
                  min={MIN_LABEL_MM}
                  max={MAX_LABEL_MM}
                  onChange={(height) => onChange({ ...layout, height })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('labels.layout.labelSize', { width: layout.width, height: layout.height })}
                </p>
                <p className="text-sm text-muted-foreground">{t('labels.layout.tapeHint')}</p>
              </div>
            </>
          ) : (
            <>
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
                <Stepper
                  label={t('labels.layout.startPosition')}
                  value={layout.startPosition}
                  min={1}
                  max={slotsPerPage(grid)}
                  onChange={(startPosition) => onChange({ ...layout, startPosition })}
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
            </>
          )}

          {tooSmall && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('labels.layout.tooSmall')}
            </p>
          )}

          <p role="status" className="font-medium">
            {t('labels.layout.labelCount', { count: items.length })} ·{' '}
            {tape ? t('labels.layout.eachOnPage') : t('labels.layout.sheetCount', { count: sheets })}
            {!tape && empty > 0 && <> · {t('labels.layout.emptyOnLast', { count: empty })}</>}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative">
            {tape ? (
              <TapePreview item={items[shownPage]!} size={tapeSize} number={shownPage + 1} fontsReady={fontsReady} />
            ) : (
              <SheetPreview
                items={items}
                grid={grid}
                startPosition={layout.startPosition}
                page={shownPage}
                fontsReady={fontsReady}
              />
            )}
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              aria-label={t('labels.layout.enlarge')}
              className="absolute inset-0 flex cursor-zoom-in items-end justify-end rounded-sm p-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span aria-hidden className="flex size-9 items-center justify-center rounded-md border bg-card text-foreground shadow-sm">
                <Maximize2 className="size-4" />
              </span>
            </button>
          </div>
          {pager}
        </div>
      </div>

      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent className="h-dvh max-h-dvh w-screen max-w-none gap-3 rounded-none border-0 p-4 sm:p-6">
          <DialogTitle>{t('labels.layout.fullscreenTitle')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t(tape ? 'labels.layout.fullscreenHintTape' : 'labels.layout.fullscreenHint')}
          </DialogDescription>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {tape ? (
              <TapePreview
                item={items[shownPage]!}
                size={tapeSize}
                number={shownPage + 1}
                fontsReady={fontsReady}
                className="max-h-full max-w-3xl"
              />
            ) : (
              <SheetPreview
                items={items}
                grid={grid}
                startPosition={layout.startPosition}
                page={shownPage}
                fontsReady={fontsReady}
                className="aspect-[210/297] h-full w-auto max-w-full"
              />
            )}
          </div>
          {pager}
        </DialogContent>
      </Dialog>
    </section>
  );
}
