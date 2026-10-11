import { FileDown, LoaderCircle, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { pdfFileName, printPdf, savePdf } from './download';
import type { LayoutChoice } from './layout-choice';
import { emptyOnLastPage, pageCount } from './layout';
import type { ChosenLocation, LabelRow } from './selection';

type Props = {
  location: ChosenLocation;
  items: LabelRow[];
  layout: LayoutChoice;
  /** Clears the choices and returns to step 1. */
  onRestart: () => void;
};

type Action = 'save' | 'print';
type State =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'done'; bytes: Uint8Array }
  | { status: 'error'; action: Action };

/** Step 4: summary and the download. The PDF is built here, in the browser, from code loaded only now. */
export function DownloadStep({ location, items, layout, onRestart }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: 'idle' });
  const grid = { columns: layout.columns, rows: layout.rows };
  const sheets = pageCount(grid, layout.startPosition, items.length);
  const empty = emptyOnLastPage(grid, layout.startPosition, items.length);
  const name = pdfFileName(location);

  // The PDF is made once: "Stáhnout" after "Vytisknout" (and the other way round) reuses the bytes.
  const build = async (): Promise<Uint8Array> => {
    if (state.status === 'done') return state.bytes;
    // The PDF library, the QR library and the fonts are a chunk of their own.
    const [{ buildLabelsPdf }, { loadLabelFonts }] = await Promise.all([import('./build-pdf'), import('./fonts')]);
    return buildLabelsPdf({
      items: items.map(({ code, name: itemName }) => ({ code, name: itemName })),
      columns: layout.columns,
      rows: layout.rows,
      startPosition: layout.startPosition,
      fonts: await loadLabelFonts(),
    });
  };

  const make = async (action: Action) => {
    const had = state.status === 'done';
    setState({ status: 'working' });
    try {
      const bytes = await build();
      if (action === 'print') printPdf(bytes);
      else savePdf(bytes, name);
      setState({ status: 'done', bytes });
    } catch {
      setState(had ? state : { status: 'error', action });
    }
  };

  const working = state.status === 'working';
  return (
    <section aria-labelledby="labels-step-heading" className="flex flex-col gap-5">
      <h3 id="labels-step-heading" className="text-lg font-semibold">
        {t('labels.download.heading')}
      </h3>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border border-line bg-card p-4 text-sm">
        <dt className="text-muted-foreground">{t('labels.download.location')}</dt>
        <dd className="font-medium break-words">{location.name}</dd>
        <dt className="text-muted-foreground">{t('labels.download.labels')}</dt>
        <dd className="font-medium">{t('labels.layout.labelCount', { count: items.length })}</dd>
        <dt className="text-muted-foreground">{t('labels.download.sheet')}</dt>
        <dd className="font-medium">{t('labels.download.grid', { columns: layout.columns, rows: layout.rows })}</dd>
        <dt className="text-muted-foreground">{t('labels.download.sheets')}</dt>
        <dd className="font-medium">
          {t('labels.layout.sheetCount', { count: sheets })}
          {empty > 0 && <span className="text-muted-foreground"> · {t('labels.layout.emptyOnLast', { count: empty })}</span>}
        </dd>
        {layout.startPosition > 1 && (
          <>
            <dt className="text-muted-foreground">{t('labels.download.start')}</dt>
            <dd className="font-medium">{t('labels.download.startPosition', { position: layout.startPosition })}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-col gap-3 sm:max-w-md">
        {/* Side by side at every width: the two ways to get the same PDF. */}
        <div className="flex gap-3">
          <Button size="default" disabled={working} onClick={() => void make('save')} className="flex-1">
            {working ? <LoaderCircle aria-hidden className="animate-spin" /> : <FileDown aria-hidden />}
            {t('labels.download.button')}
          </Button>
          <Button variant="outline" disabled={working} onClick={() => void make('print')} className="flex-1">
            <Printer aria-hidden />
            {t('labels.download.print')}
          </Button>
        </div>
        <div role="status" className="text-sm">
          {working && <p>{t('labels.download.working')}</p>}
        </div>
        {state.status === 'error' && (
          <p role="alert" className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
            {t('labels.download.failed')}
            <Button variant="link" onClick={() => void make(state.action)}>
              {t('labels.download.retry')}
            </Button>
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t('labels.download.tip')}</p>
      </div>

      {state.status === 'done' && (
        <div className="pt-6">
          <Button variant="outline" onClick={onRestart}>
            {t('labels.download.restart')}
          </Button>
        </div>
      )}
    </section>
  );
}
