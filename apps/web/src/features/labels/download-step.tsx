import { FileDown, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { savePdf, pdfFileName } from './download';
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

type State = { status: 'idle' } | { status: 'working' } | { status: 'done'; bytes: Uint8Array } | { status: 'error' };

/** Step 4: summary and the download. The PDF is built here, in the browser, from code loaded only now. */
export function DownloadStep({ location, items, layout, onRestart }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: 'idle' });
  const grid = { columns: layout.columns, rows: layout.rows };
  const sheets = pageCount(grid, layout.startPosition, items.length);
  const empty = emptyOnLastPage(grid, layout.startPosition, items.length);
  const name = pdfFileName(location.code);

  const make = async () => {
    setState({ status: 'working' });
    try {
      // The PDF library, the QR library and the fonts are a chunk of their own.
      const [{ buildLabelsPdf }, { loadLabelFonts }] = await Promise.all([import('./build-pdf'), import('./fonts')]);
      const bytes = await buildLabelsPdf({
        items: items.map(({ code, name: itemName }) => ({ code, name: itemName })),
        columns: layout.columns,
        rows: layout.rows,
        startPosition: layout.startPosition,
        fonts: await loadLabelFonts(),
      });
      savePdf(bytes, name);
      setState({ status: 'done', bytes });
    } catch {
      setState({ status: 'error' });
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

      <div className="flex flex-col gap-3 sm:max-w-sm">
        <Button size="default" disabled={working} onClick={() => void make()} className="w-full">
          {working ? <LoaderCircle aria-hidden className="animate-spin" /> : <FileDown aria-hidden />}
          {t('labels.download.button')}
        </Button>
        <div role="status" className="text-sm">
          {working && <p>{t('labels.download.working')}</p>}
          {state.status === 'done' && (
            <p className="flex flex-wrap items-center gap-x-2">
              {t('labels.download.done')}
              <Button variant="link" onClick={() => savePdf(state.bytes, name)}>
                {t('labels.download.again')}
              </Button>
            </p>
          )}
        </div>
        {state.status === 'error' && (
          <p role="alert" className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
            {t('labels.download.failed')}
            <Button variant="link" onClick={() => void make()}>
              {t('labels.download.retry')}
            </Button>
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t('labels.download.tip')}</p>
      </div>

      {state.status === 'done' && (
        <div>
          <Button variant="outline" onClick={onRestart}>
            {t('labels.download.restart')}
          </Button>
        </div>
      )}
    </section>
  );
}
