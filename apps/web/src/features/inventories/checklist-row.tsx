import type { InventoryRowDto } from '@inventory/shared';
import { Link } from '@tanstack/react-router';
import { Check, ChevronRight, ScanLine } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { pathLabel } from '@/features/locations/path';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { shortName } from './people';

type Props = {
  row: InventoryRowDto;
  /** A writer on a run in progress: the row has a checkbox. Everyone else sees the state only. */
  canEdit: boolean;
  /** The state a tick that is still on its way will leave, shown until the server answers. */
  pendingChecked: boolean | undefined;
  onToggle: (checked: boolean) => void;
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

/** Who checked the row and when, and how (or the badge of an item that was not on the list). */
function CheckInfo({ row }: { row: InventoryRowDto }) {
  const { t } = useTranslation();
  const badge =
    row.registeredElsewhere ? (
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
 * Space toggle it, nothing else to build); the chevron beside it opens the item. The checkbox is the
 * native one, hidden visually, so a screen reader and the keyboard get the real control.
 */
export function ChecklistRow({ row, canEdit, pendingChecked, onToggle }: Props) {
  const { t } = useTranslation();
  const nameId = useId();
  const detailId = useId();
  const checked = pendingChecked ?? row.checkedAt !== null;
  // Warning colours only while the item is registered somewhere else; once its location was set
  // to this one, it is an ordinary check.
  const found = row.registeredElsewhere;

  const text: ReactNode = (
    <>
      <span className="min-w-0">
        <span id={nameId} className="block text-[15px] font-semibold break-words">
          {row.name}
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
    <li className="flex items-center border-b border-line last:border-b-0" aria-busy={pendingChecked !== undefined}>
      {canEdit ? (
        <label className={cn(rowClass, 'cursor-pointer hover:bg-accent')}>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={checked}
            aria-labelledby={nameId}
            aria-describedby={detailId}
            // A tick on its way is not a second chance to change one's mind: ignore taps until the server answers.
            onChange={(event) => pendingChecked === undefined && onToggle(event.target.checked)}
          />
          <span
            aria-hidden
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-[7px] border-2 border-input bg-card text-primary-foreground',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
              checked && (found ? 'border-warning bg-warning text-background' : 'border-primary bg-primary'),
              pendingChecked !== undefined && 'opacity-60',
            )}
          >
            {checked && <Check className="size-3.5" strokeWidth={3} />}
          </span>
          {text}
        </label>
      ) : (
        <div className={rowClass}>{text}</div>
      )}
      <Link
        to="/items/$id"
        params={{ id: row.id }}
        aria-label={t('inventory.checklist.openItem', { name: row.name })}
        className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </li>
  );
}
