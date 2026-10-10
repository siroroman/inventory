import type { InventoryDto, InventoryLocationDto } from '@inventory/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router';
import { CameraOff, Flashlight, FlashlightOff, X } from 'lucide-react';
import { type ComponentProps, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/features/auth/use-can-write';
import { useCodeReader } from '@/features/scanner/use-code-reader';
import { ApiError, isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { inventoryQueryOptions, scanInventory } from './api';
import { locationFigures, progressOf, runFigures } from './inventory-summary';
import { announcementOf, autoCloseMs, closesItself, ScanSheet, type Sheet, sheetContent, sheetOfResult } from './scan-sheet';

const roundButton =
  'rounded-full bg-panel-foreground/15 text-panel-foreground hover:bg-panel-foreground/25 hover:text-panel-foreground';

/** Where "Zavřít" leads when there is no screen to go back to: the checklist the scanner was opened from, or the overview. */
function ToWork({
  id,
  locationId,
  children,
  ...rest
}: { id: string; locationId?: string } & Omit<ComponentProps<'a'>, 'href'>) {
  return locationId ? (
    <Link to="/inventories/$id/locations/$locationId" params={{ id, locationId }} {...rest}>
      {children}
    </Link>
  ) : (
    <Link to="/inventories/$id" params={{ id }} {...rest}>
      {children}
    </Link>
  );
}

/** The × of the top row: back to where the scanner was opened from. */
function CloseButton({ id, locationId }: { id: string; locationId?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const label = t('inventory.scanner.closeLabel');
  const icon = <X aria-hidden className="size-5" strokeWidth={2.2} />;
  return canGoBack ? (
    <Button size="icon" variant="ghost" className={roundButton} aria-label={label} onClick={() => router.history.back()}>
      {icon}
    </Button>
  ) : (
    <Button asChild size="icon" variant="ghost" className={roundButton}>
      <ToWork id={id} locationId={locationId} aria-label={label}>
        {icon}
      </ToWork>
    </Button>
  );
}

/** The dark full-screen frame: close, what is being checked, how far it is; the camera or a message below. */
function Frame({
  id,
  locationId,
  title,
  counter,
  children,
}: {
  id: string;
  locationId?: string;
  title: string;
  counter?: { done: number; total: number };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-panel text-panel-foreground">
      <header className="relative z-10 flex items-center gap-3 p-4">
        <CloseButton id={id} locationId={locationId} />
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{title}</h1>
        {counter ? (
          <span className="rounded-full bg-panel-foreground/15 px-3 py-1.5 text-[13px] font-bold">
            <span aria-hidden>
              {counter.done} / {counter.total}
            </span>
            <span className="sr-only">{t('inventory.scanner.counterLabel', counter)}</span>
          </span>
        ) : (
          // Keeps the title in the middle.
          <span aria-hidden className="size-11" />
        )}
      </header>
      <div className="relative flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/** A message in the middle of the dark screen: why there is no camera, or why there is no scanning. */
function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <CameraOff aria-hidden className="size-9 text-panel-muted" />
      <p className="text-[17px] font-semibold">{title}</p>
      {children}
    </div>
  );
}

const lightButton = 'border-0 bg-panel-foreground text-panel hover:bg-panel-foreground/90';

/** The four corners of the viewfinder and the hint below it. */
function Viewfinder() {
  const { t } = useTranslation();
  return (
    <div aria-hidden className="pointer-events-none absolute top-[38%] left-1/2 size-[230px] -translate-x-1/2 -translate-y-1/2">
      <svg
        aria-hidden="true"
        viewBox="0 0 230 230"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className="absolute inset-0 text-panel-foreground"
      >
        <path d="M4 40V12a8 8 0 0 1 8-8h28" />
        <path d="M190 4h28a8 8 0 0 1 8 8v28" />
        <path d="M226 190v28a8 8 0 0 1-8 8h-28" />
        <path d="M40 226H12a8 8 0 0 1-8-8v-28" />
      </svg>
      <p className="absolute top-full left-1/2 mt-5 w-64 -translate-x-1/2 text-center text-[13px] text-panel-muted">
        {t('inventory.scanner.hint')}
      </p>
    </div>
  );
}

function errorSheet(error: unknown): Sheet {
  const code = error instanceof ApiError ? error.code : 'unexpected';
  const status = error instanceof ApiError ? error.status : 0;
  return {
    kind: 'error',
    message: problemMessage(error),
    // Somebody finished or cancelled the run meanwhile: another try cannot work.
    ended: code === 'inventory_closed',
    // No connection, a server fault or too many requests may pass; a refusal will not.
    retry: status === 0 || status >= 500 || status === 429 || code === 'unexpected',
  };
}

/** A short buzz where the phone has one (not iOS): one pulse for a find, three for anything to look at. */
function buzz(sheet: Sheet) {
  if (!('vibrate' in navigator)) return;
  navigator.vibrate(sheet.kind === 'found' || sheet.kind === 'elsewhere' ? 40 : [60, 40, 60]);
}

/** The camera, the sheets over it and the live regions that tell a screen reader what was read. */
function ScannerCamera({ inventory, location }: { inventory: InventoryDto; location: InventoryLocationDto | undefined }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<{ n: number; sheet: Sheet } | null>(null);
  const count = useRef(0);
  const lastCode = useRef<string | null>(null);

  const show = useCallback((sheet: Sheet) => {
    count.current += 1;
    setShown({ n: count.current, sheet });
    buzz(sheet);
  }, []);

  const scan = useMutation({
    mutationFn: (code: string) => scanInventory(inventory.id, { code, locationId: location?.id }),
    meta: { silentError: true },
    onSuccess: (result, code) => show(sheetOfResult(result, code)),
    onError: (error) => show(errorSheet(error)),
    // The counter and the checklist behind this screen follow what was just saved (or lost).
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['inventories'] }),
  });

  const reader = useCodeReader({
    // A failed scan waits for the person: reading on would only pile up more of them.
    paused: shown?.sheet.kind === 'error',
    onCode: ({ code }) => {
      // One at a time; the reader offers this label again at its next look.
      if (scan.isPending) return false;
      if (code === null) {
        show({ kind: 'foreign' });
      } else {
        lastCode.current = code;
        scan.mutate(code);
      }
      return true;
    },
  });

  const sheet = shown?.sheet ?? null;
  const close = useCallback(() => setShown(null), []);

  useEffect(() => {
    if (!shown || !closesItself(shown.sheet)) return;
    const timer = setTimeout(close, autoCloseMs);
    return () => clearTimeout(timer);
  }, [shown, close]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet, close]);

  const announcement = sheet ? announcementOf(sheetContent(sheet, t)) : '';
  const locationId = location?.id;

  let state: ReactNode = null;
  if (reader.status === 'starting') {
    state = (
      <p role="status" className="flex h-full items-center justify-center text-sm text-panel-muted">
        {t('inventory.scanner.starting')}
      </p>
    );
  } else if (reader.status !== 'running') {
    const kind = reader.status === 'denied' ? 'denied' : reader.status === 'unavailable' ? 'unavailable' : 'error';
    state = (
      <Message title={t(`inventory.scanner.camera.${kind}Title`)}>
        <p className="max-w-xs text-sm text-panel-muted">{t(`inventory.scanner.camera.${kind}Hint`)}</p>
        {kind === 'denied' && (
          <ul className="max-w-xs list-none space-y-1 text-sm text-panel-muted">
            <li>{t('inventory.scanner.camera.deniedIphone')}</li>
            <li>{t('inventory.scanner.camera.deniedAndroid')}</li>
          </ul>
        )}
        <div className="mt-2 flex flex-col items-stretch gap-2">
          {kind !== 'unavailable' && (
            <Button className={lightButton} onClick={reader.retry}>
              {t('inventory.scanner.camera.retry')}
            </Button>
          )}
          <Button asChild variant="ghost" className={roundButton}>
            <ToWork id={inventory.id} locationId={locationId}>
              {t('inventory.scanner.camera.checkManually')}
            </ToWork>
          </Button>
        </div>
      </Message>
    );
  }

  return (
    <>
      {/* The picture only; nothing in it is for a screen reader. Muted and inline, or iOS will not play it. */}
      <video ref={reader.videoRef} playsInline muted autoPlay aria-hidden className="absolute inset-0 size-full object-cover" />
      {reader.status === 'running' ? <Viewfinder /> : state}

      {/* The torch stays above the sheet, so it can be switched while a sheet is up. Without a sheet it keeps clear of the edge. */}
      <div className={cn('absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4', !sheet && 'pb-11')}>
        {reader.status === 'running' && reader.torch.supported && (
          <Button
            size="icon"
            variant="ghost"
            className={`size-[52px] ${roundButton}`}
            aria-label={t('inventory.scanner.torch')}
            aria-pressed={reader.torch.on}
            onClick={() => void reader.torch.toggle()}
          >
            {reader.torch.on ? <FlashlightOff aria-hidden className="size-6" /> : <Flashlight aria-hidden className="size-6" />}
          </Button>
        )}
        {sheet && (
          <ScanSheet
            key={shown?.n}
            sheet={sheet}
            inventoryId={inventory.id}
            onClose={close}
            retrying={scan.isPending}
            onRetry={() => lastCode.current && scan.mutate(lastCode.current)}
          />
        )}
      </div>

      {/* Read out when it changes; a new key makes the same sentence count as new. */}
      <div className="sr-only" role="status">
        {shown && shown.sheet.kind !== 'error' && <span key={shown.n}>{announcement}</span>}
      </div>
      <div className="sr-only" role="alert">
        {shown?.sheet.kind === 'error' && <span key={shown.n}>{announcement}</span>}
      </div>
    </>
  );
}

/**
 * The scanner of a run: the camera reads the QR labels of items and each one is checked as it comes
 * into view (SPEC §9.4.5). Opened from a checklist, it works in that location; from the overview, in
 * the run's root. Only a writer on a run in progress gets the camera.
 */
export function InventoryScanner({ id, locationId }: { id: string; locationId?: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery(inventoryQueryOptions(id));
  const inventory = query.data;
  const location = locationId ? inventory?.locations.find((candidate) => candidate.id === locationId) : undefined;

  let title = t('inventory.scanner.title');
  let counter: { done: number; total: number } | undefined;
  let body: ReactNode;

  const toOverview = (
    <Button asChild variant="ghost" className={roundButton}>
      <Link to="/inventories/$id" params={{ id }}>
        {t('inventory.scanner.toOverview')}
      </Link>
    </Button>
  );

  if (!canWrite) {
    body = <Message title={t('errors.forbidden')} />;
  } else if (query.isError) {
    body = isMissingRecord(query.error) ? (
      <Message title={t('inventory.notFoundTitle')}>
        <p className="max-w-xs text-sm text-panel-muted">{t('inventory.notFoundHint')}</p>
      </Message>
    ) : (
      <Message title={problemMessage(query.error)}>
        <Button className={lightButton} onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </Message>
    );
  } else if (!inventory) {
    body = (
      <p role="status" aria-label={t('states.loading')} className="flex h-full items-center justify-center text-sm text-panel-muted">
        {t('inventory.scanner.starting')}
      </p>
    );
  } else if (inventory.status !== 'in_progress') {
    body = (
      <Message title={t('inventory.scanner.endedTitle')}>
        <p className="max-w-xs text-sm text-panel-muted">{t('inventory.scanner.endedHint')}</p>
        {toOverview}
      </Message>
    );
  } else if (locationId && !location) {
    // A location with no rows in the run has no checklist and nothing to check there.
    body = (
      <Message title={t('inventory.checklist.notFoundTitle')}>
        <p className="max-w-xs text-sm text-panel-muted">{t('inventory.checklist.notFoundHint')}</p>
        {toOverview}
      </Message>
    );
  } else {
    title = location?.name ?? inventory.location.name;
    // The same "10 / 10" as the bar of the screen the scanner was opened from.
    counter = progressOf(location ? locationFigures(location) : runFigures(inventory.counts));
    body = <ScannerCamera inventory={inventory} location={location} />;
  }

  return (
    <Frame id={id} locationId={locationId} title={title} counter={counter}>
      {body}
    </Frame>
  );
}
