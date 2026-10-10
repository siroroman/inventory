import type { InventoryRowDto, ScanResultDto, ScannedItemDto } from '@inventory/shared';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { CircleCheck, Info, MapPin, TriangleAlert, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { pathLabel } from '@/features/locations/path';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { shortName } from './people';

/** How long the sheet of a plain "Nalezeno" stays before it closes by itself. */
export const autoCloseMs = 2000;

/** What the scanner tells the person after a reading; one per kind of answer (SPEC §9.4.5). */
export type Sheet =
  | { kind: 'found'; item: ScannedItemDto; misplaced: boolean; wasMissing: boolean }
  | { kind: 'elsewhere'; item: ScannedItemDto; wasMissing: boolean }
  | { kind: 'already'; item: ScannedItemDto; row: InventoryRowDto }
  | { kind: 'archived'; item: ScannedItemDto }
  | { kind: 'unknown'; code: string }
  | { kind: 'foreign' }
  /** The request failed. `retry`: it may work on another try (no connection, a server fault). `ended`: the run was closed meanwhile. */
  | { kind: 'error'; message: string; retry: boolean; ended: boolean };

export function sheetOfResult(result: ScanResultDto, code: string): Sheet {
  switch (result.outcome) {
    case 'found':
      return { kind: 'found', item: result.item, misplaced: result.misplaced, wasMissing: result.wasMissing };
    case 'found_elsewhere':
      return { kind: 'elsewhere', item: result.item, wasMissing: result.wasMissing };
    case 'already_checked':
      return { kind: 'already', item: result.item, row: result.row };
    case 'archived':
      return { kind: 'archived', item: result.item };
    case 'unknown_code':
      return { kind: 'unknown', code };
  }
}

/**
 * Only a plain "Nalezeno" goes away on its own. Every other sheet says something the person has to
 * take in (a warning, who checked it already), so it stays until the next scan or "Zavřít".
 */
export const closesItself = (sheet: Sheet) => sheet.kind === 'found' && !sheet.misplaced && !sheet.wasMissing;

/** Where the scan is in the way: the sheet's colour and icon. */
type Tone = 'success' | 'warning' | 'neutral' | 'info' | 'danger';

export type Content = {
  tone: Tone;
  title: string;
  name?: string;
  /** The ID, and for a plain "Nalezeno" the room it is in. */
  detail?: string;
  /** "Vedeno v: …", in the warning colour. */
  registeredIn?: string;
  note?: string;
};

/** The words of a sheet. Also what a screen reader is told, so it reads the same as the sheet. */
export function sheetContent(sheet: Sheet, t: TFunction): Content {
  const registeredIn = (item: ScannedItemDto) =>
    t('inventory.checklist.registeredIn', {
      path: item.path.length > 0 ? pathLabel(item.path) : t('inventory.checklist.noLocation'),
    });

  switch (sheet.kind) {
    case 'found': {
      const wasMissing = sheet.wasMissing;
      return {
        tone: 'success',
        title: t(wasMissing ? 'inventory.scanner.sheet.wasMissing' : 'inventory.scanner.sheet.found'),
        name: sheet.item.name,
        // A misplaced item says where it belongs instead of naming the room it was just found in.
        detail: sheet.misplaced ? sheet.item.code : `${sheet.item.code} · ${sheet.item.path.at(-1)?.name ?? t('inventory.checklist.noLocation')}`,
        registeredIn: sheet.misplaced ? registeredIn(sheet.item) : undefined,
        note: wasMissing ? t('inventory.scanner.sheet.wasMissingNote') : undefined,
      };
    }
    case 'elsewhere':
      return {
        tone: 'warning',
        title: t('inventory.scanner.sheet.elsewhere'),
        name: sheet.item.name,
        detail: sheet.item.code,
        registeredIn: registeredIn(sheet.item),
        note: sheet.wasMissing ? t('inventory.scanner.sheet.wasMissingNote') : undefined,
      };
    case 'already': {
      const { checkedBy, checkedAt } = sheet.row;
      const time = checkedAt ? formatTime(checkedAt) : '';
      return {
        tone: 'neutral',
        title: t('inventory.scanner.sheet.alreadyChecked'),
        name: sheet.item.name,
        detail: sheet.item.code,
        note: checkedBy
          ? t('inventory.scanner.sheet.checkedBy', { who: shortName(checkedBy), time })
          : t('inventory.scanner.sheet.checkedAt', { time }),
      };
    }
    case 'archived':
      return {
        tone: 'info',
        title: t('inventory.scanner.sheet.archived'),
        name: sheet.item.name,
        detail: sheet.item.code,
        note: t('inventory.scanner.sheet.archivedNote'),
      };
    case 'unknown':
      return {
        tone: 'neutral',
        title: t('inventory.scanner.sheet.unknown'),
        note: t('inventory.scanner.sheet.unknownNote', { code: sheet.code }),
      };
    case 'foreign':
      return {
        tone: 'neutral',
        title: t('inventory.scanner.sheet.foreign'),
        note: t('inventory.scanner.sheet.foreignNote'),
      };
    case 'error':
      return { tone: 'danger', title: t('inventory.scanner.sheet.notSaved'), note: sheet.message };
  }
}

/** The sheet as one sentence for the screen's live region. */
export const announcementOf = (content: Content) =>
  [content.title, content.name, content.detail, content.registeredIn, content.note].filter(Boolean).join('. ');

const toneClasses: Record<Tone, { circle: string; title: string; icon: ReactNode }> = {
  success: {
    circle: 'bg-success-soft',
    title: 'text-success',
    icon: <CircleCheck aria-hidden className="size-[18px] text-success" strokeWidth={2.6} />,
  },
  warning: {
    circle: 'bg-warning-soft',
    title: 'text-warning',
    icon: <MapPin aria-hidden className="size-[18px] text-warning" strokeWidth={2.2} />,
  },
  neutral: {
    circle: 'bg-muted',
    title: 'text-secondary-foreground',
    icon: <Info aria-hidden className="size-[18px] text-secondary-foreground" strokeWidth={2.2} />,
  },
  info: {
    circle: 'bg-primary-soft',
    title: 'text-primary',
    icon: <Info aria-hidden className="size-[18px] text-primary" strokeWidth={2.2} />,
  },
  danger: {
    circle: 'bg-danger-soft',
    title: 'text-destructive',
    icon: <WifiOff aria-hidden className="size-[18px] text-destructive" strokeWidth={2.2} />,
  },
};

type Props = {
  sheet: Sheet;
  onClose: () => void;
  /** "Zkusit znovu" of a failed scan; `retrying`: it is on its way. */
  onRetry: () => void;
  retrying: boolean;
  /** Where "Zpět na přehled inventury" of an ended run leads. */
  inventoryId: string;
};

/**
 * The bottom sheet over the camera. It is not a dialog: the camera keeps scanning behind it, and
 * the next reading replaces it. A screen reader hears it through the live region of the screen.
 */
export function ScanSheet({ sheet, onClose, onRetry, retrying, inventoryId }: Props) {
  const { t } = useTranslation();
  const content = sheetContent(sheet, t);
  const tone = toneClasses[content.tone];
  // The icon of a failed scan says "no connection" only for that; a refused one is a warning.
  const icon = sheet.kind === 'error' && !sheet.retry ? <TriangleAlert aria-hidden className="size-[18px] text-destructive" strokeWidth={2.2} /> : tone.icon;

  let actions: ReactNode;
  if (closesItself(sheet)) {
    actions = <span className="text-xs text-muted-foreground">{t('inventory.scanner.sheet.closesItself')}</span>;
  } else if (sheet.kind === 'error') {
    actions = (
      <div className="flex items-center gap-2">
        {sheet.ended ? (
          <Button asChild>
            <Link to="/inventories/$id" params={{ id: inventoryId }}>
              {t('inventory.scanner.toOverview')}
            </Link>
          </Button>
        ) : (
          sheet.retry && (
            <Button className="flex-1" disabled={retrying} onClick={onRetry}>
              {t('inventory.scanner.sheet.retry')}
            </Button>
          )
        )}
        <Button variant="ghost" onClick={onClose}>
          {t('inventory.scanner.sheet.close')}
        </Button>
      </div>
    );
  } else {
    actions = (
      <Button variant={sheet.kind === 'unknown' ? 'default' : 'outline'} onClick={onClose}>
        {t(sheet.kind === 'unknown' ? 'inventory.scanner.sheet.scanOn' : 'inventory.scanner.sheet.close')}
      </Button>
    );
  }

  return (
    <section
      aria-label={content.title}
      className="flex w-full flex-col gap-3 rounded-t-[20px] bg-card p-5 pb-8 text-card-foreground"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-full', tone.circle)}>{icon}</span>
        <h2 className={cn('text-[15px] font-bold', tone.title)}>{content.title}</h2>
      </div>
      {(content.name || content.detail || content.registeredIn || content.note) && (
        <div className="flex flex-col gap-1">
          {content.name && <p className="text-[15px] font-semibold break-words">{content.name}</p>}
          {content.detail && <p className="text-sm break-words text-muted-foreground">{content.detail}</p>}
          {content.registeredIn && <p className="text-sm break-words text-warning">{content.registeredIn}</p>}
          {content.note && <p className="text-sm break-words text-muted-foreground">{content.note}</p>}
        </div>
      )}
      {actions}
    </section>
  );
}
