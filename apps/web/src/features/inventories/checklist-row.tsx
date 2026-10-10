import type { InventoryRowDto } from '@inventory/shared';
import { Link } from '@tanstack/react-router';
import { Check, ScanLine, SearchX } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { pathLabel } from '@/features/locations/path';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { shortName } from './people';
import { pendingChecked as pendingCheckedOf, type RowAction } from './use-tick-item';

type Props = {
  row: InventoryRowDto;
  /** A writer on a run in progress: the row has a checkbox. Everyone else sees the state only. */
  canEdit: boolean;
  /** The change that is still on its way, shown until the server answers. */
  pending: RowAction | undefined;
  onToggle: (checked: boolean) => void;
  /** Flags the item as missing, or takes the flag back. */
  onToggleMissing: (missing: boolean) => void;
};

/** What a row says besides its name: the item's ID and, for an item found elsewhere (still registered there) or added, where it came from. */
function RowDetails({ row, id }: { row: InventoryRowDto; id: string }) {
  const { t } = useTranslation();
  return (
    <span id={id} className="block text-sm text-muted-foreground">
      <span className="block break-words">{row.code}</span>
      {row.registeredElsewhere && (
        <span className="block break-words text-warning">
          {t('inventory.checklist.registeredIn', {
            path: row.registeredPath.length > 0 ? pathLabel(row.registeredPath) : t('inventory.checklist.noLocation'),
          })}
          {row.moved && ` · ${t('inventory.checklist.moved')}`}
        </span>
      )}
      {row.kind === 'new' && <span className="block">{t('inventory.checklist.addedDuringInventory')}</span>}
    </span>
  );
}

/** Who checked the row and when, and how (or the badge of an item flagged as missing, or of one that was not on the list). */
function CheckInfo({ row }: { row: InventoryRowDto }) {
  const { t } = useTranslation();
  const badge =
    row.missing ? (
      <Badge variant="danger">{t('inventory.checklist.missing')}</Badge>
    ) : row.registeredElsewhere ? (
      <Badge variant="warning">{t('inventory.checklist.elsewhere')}</Badge>
    ) : row.kind === 'new' ? (
      <Badge variant="info">{t('inventory.checklist.new')}</Badge>
    ) : null;
  // Both cells are always there: on a wide screen they are two grid columns, and an empty one
  // keeps the other where it belongs. On a phone an empty cell takes no room.
  return (
    <span className="flex flex-col items-end gap-0.5 text-right md:contents">
      <span className="text-xs whitespace-nowrap text-muted-foreground max-md:empty:hidden md:text-sm">
        {row.checkedAt && `${row.checkedBy ? `${shortName(row.checkedBy)} · ` : ''}${formatTime(row.checkedAt)}`}
      </span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground max-md:empty:hidden md:text-sm">
        {badge ??
          (row.method && (
            <>
              {row.method === 'scan' && <ScanLine aria-hidden className="size-3 md:size-3.5" />}
              {t(`inventory.checklist.method.${row.method}`)}
            </>
          ))}
      </span>
    </span>
  );
}

/**
 * One item of a checklist. For a writer the whole row is a label of a checkbox (a tap anywhere and
 * Space toggle it, nothing else to build); the item's name, underlined, is a link that opens the
 * item instead of toggling (a link inside a label does not activate it). The checkbox is the
 * native one, hidden visually, so a screen reader and the keyboard get the real control.
 */
export function ChecklistRow({ row, canEdit, pending, onToggle, onToggleMissing }: Props) {
  const { t } = useTranslation();
  const nameId = useId();
  const detailId = useId();
  const pendingChecked = pendingCheckedOf(pending);
  const checked = pendingChecked ?? row.checkedAt !== null;
  // Only an unchecked item of the list can be missing. A check takes the flag back, so a checked row never has one.
  const canFlag = canEdit && row.kind === 'expected' && !checked;
  const flagLabel = t(row.missing ? 'inventory.checklist.unflag' : 'inventory.checklist.flag', { name: row.name });
  // Warning colours only while the item is registered somewhere else; once its location was set
  // to this one, it is an ordinary check.
  const found = row.registeredElsewhere;

  const text: ReactNode = (
    <>
      <span className="min-w-0">
        <span id={nameId} className="block text-[15px] font-semibold break-words">
          {/* The padding makes the link taller to hit than its line of text, without moving the lines. */}
          <Link
            to="/items/$id"
            params={{ id: row.id }}
            className="-my-1.5 inline-block rounded-sm py-1.5 underline underline-offset-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.name}
          </Link>
        </span>
        <RowDetails row={row} id={detailId} />
      </span>
      <CheckInfo row={row} />
    </>
  );

  const grid = canEdit
    ? 'grid-cols-[auto_1fr_auto] md:grid-cols-[auto_2fr_1fr_1.4fr]'
    : 'grid-cols-[1fr_auto] md:grid-cols-[2fr_1fr_1.4fr]';
  const rowClass = cn('grid min-h-14 flex-1 items-center gap-x-3 px-4 py-2 md:gap-x-4 md:px-5', grid);

  return (
    <li className="flex items-center border-b border-line last:border-b-0" aria-busy={pending !== undefined}>
      {canEdit ? (
        <label className={cn(rowClass, 'cursor-pointer hover:bg-accent')}>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={checked}
            aria-labelledby={nameId}
            aria-describedby={detailId}
            // A change on its way is not a second chance to change one's mind: ignore taps until the server answers.
            onChange={(event) => pending === undefined && onToggle(event.target.checked)}
          />
          <span
            aria-hidden
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-[7px] border-2 border-input bg-card text-primary-foreground',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
              checked && (found ? 'border-warning bg-warning text-background' : 'border-primary bg-primary'),
              pending !== undefined && 'opacity-60',
            )}
          >
            {checked && <Check className="size-3.5" strokeWidth={3} />}
          </span>
          {text}
        </label>
      ) : (
        <div className={rowClass}>{text}</div>
      )}
      {canFlag && (
        <button
          type="button"
          aria-label={flagLabel}
          title={flagLabel}
          disabled={pending !== undefined}
          onClick={() => onToggleMissing(!row.missing)}
          className={cn(
            'mr-1 flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
            row.missing ? 'bg-danger-soft text-destructive' : 'text-muted-foreground',
          )}
        >
          <SearchX aria-hidden className="size-4" />
        </button>
      )}
    </li>
  );
}
