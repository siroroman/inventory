import type { UseQueryResult } from '@tanstack/react-query';
import { MAX_LABELS } from '@inventory/shared';
import { X } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';
import { useMediaQuery } from '@/lib/use-media-query';
import { QuickAdd } from './quick-add';
import { type AddedRow, type ChosenLocation, type LabelRow, pathBelow, type Selection } from './selection';

export type ListedItems = UseQueryResult<{ items: LabelRow[]; total: number }>;

type Props = {
  location: ChosenLocation;
  listed: ListedItems;
  selection: Selection;
  /** How many items will get a label. */
  chosen: number;
  onChange: (selection: Selection) => void;
};

const count = new Intl.NumberFormat('cs-CZ');
// Tailwind's `md`: from here the rows are a table.
const tableScreen = '(min-width: 768px)';
/** Rows shown at first, and added by each "Zobrazit další". */
export const ROWS_PER_PAGE = 10;

type RowProps = {
  row: LabelRow;
  /** The path to show: below the chosen location for its items, the whole path for those added by hand. */
  place: string;
  checked: boolean;
  onToggle: () => void;
  /** Items added by hand carry a badge and a remove button. */
  onRemove?: () => void;
};

function Place({ place }: { place: string }) {
  const { t } = useTranslation();
  return place || <span className="text-muted-foreground">{t('labels.items.inLocation')}</span>;
}

function CardRow({ row, place, checked, onToggle, onRemove }: RowProps) {
  const { t } = useTranslation();
  return (
    <li className="flex items-stretch">
      {/* The whole row is the label of its checkbox: a 44 px target. */}
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={t('labels.items.check', { name: row.name })}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold break-words">{row.name}</span>
          <span className="block text-sm text-muted-foreground">{row.code}</span>
          <span className="block text-sm break-words">
            <Place place={place} />
          </span>
          {onRemove && <Badge variant="info">{t('labels.items.addedBadge')}</Badge>}
        </span>
      </label>
      {onRemove && <RemoveButton name={row.name} onClick={onRemove} />}
    </li>
  );
}

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="icon" aria-label={t('labels.items.remove', { name })} onClick={onClick} className="self-center">
      <X aria-hidden />
    </Button>
  );
}

/** Toggles the row unless the click was on a control of its own or ended a text selection. */
function toggleByRowClick(event: MouseEvent<HTMLElement>, toggle: () => void) {
  if ((event.target as HTMLElement).closest('input, button, label, a')) return;
  if (window.getSelection()?.toString()) return;
  toggle();
}

function TableRows({ rows }: { rows: RowProps[] }) {
  const { t } = useTranslation();
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b bg-muted/40 text-muted-foreground">
        <tr>
          <th scope="col" className="w-12 px-4 py-2.5">
            <span className="sr-only">{t('labels.items.listLabel')}</span>
          </th>
          <th scope="col" className="px-2 py-2.5 font-medium">
            {t('labels.items.columns.name')}
          </th>
          <th scope="col" className="w-44 px-2 py-2.5 font-medium">
            {t('labels.items.columns.code')}
          </th>
          <th scope="col" className="px-2 py-2.5 font-medium">
            {t('labels.items.columns.location')}
          </th>
          <th scope="col" className="w-12 px-2 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map(({ row, place, checked, onToggle, onRemove }) => (
          // A click anywhere on the row toggles it. This is a click handler and not a label stretched
          // over the row with an absolutely positioned pseudo-element: Safari does not make a table
          // row the containing block, so there each stretched label covered the whole page.
          // Keyboard and screen reader users have the checkbox.
          <tr key={row.id} onClick={(event) => toggleByRowClick(event, onToggle)} className="cursor-pointer hover:bg-accent">
            <td className="px-4">
              <label className="flex min-h-11 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={onToggle}
                  aria-label={t('labels.items.check', { name: row.name })}
                  className="size-5 accent-primary"
                />
              </label>
            </td>
            <td className="px-2 py-3 font-semibold break-words">
              {row.name}
              {onRemove && (
                <>
                  {' '}
                  <Badge variant="info">{t('labels.items.addedBadge')}</Badge>
                </>
              )}
            </td>
            <td className="px-2 py-3">{row.code}</td>
            <td className="px-2 py-3 break-words">
              <Place place={place} />
            </td>
            <td className="px-2">
              {onRemove && <RemoveButton name={row.name} onClick={onRemove} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Step 2: everything in the location is chosen; uncheck what is not to get a label, add what is from elsewhere. */
export function ItemsStep({ location, listed, selection, chosen, onChange }: Props) {
  const { t } = useTranslation();
  const table = useMediaQuery(tableScreen);
  // A long list would push the rest of the step far down, so it shows a page of rows and the
  // button below it adds the next page; the summary above it does the work for most.
  const [shown, setShown] = useState(ROWS_PER_PAGE);

  const items = listed.data?.items ?? [];
  const total = (listed.data?.total ?? 0) + selection.added.filter((row) => !items.some((i) => i.id === row.id)).length;
  const excluded = new Set(selection.excluded);
  const inList = new Set([...items.map((row) => row.id), ...selection.added.map((row) => row.id)]);
  const tooMany = chosen > MAX_LABELS;
  const truncated = listed.data !== undefined && listed.data.total > items.length;

  const toggleListed = (id: string) =>
    onChange({
      ...selection,
      excluded: excluded.has(id) ? selection.excluded.filter((other) => other !== id) : [...selection.excluded, id],
    });
  const toggleAdded = (id: string) =>
    onChange({
      ...selection,
      added: selection.added.map((row) => (row.id === id ? { ...row, checked: !row.checked } : row)),
    });
  const removeAdded = (id: string) => onChange({ ...selection, added: selection.added.filter((row) => row.id !== id) });
  const add = (row: LabelRow) => {
    if (inList.has(row.id)) return;
    // Newest first, under "Přidané ručně".
    const entry: AddedRow = { ...row, checked: true };
    onChange({ ...selection, added: [entry, ...selection.added] });
  };

  const rows: RowProps[] = [
    ...selection.added.map((row) => ({
      row,
      place: row.path,
      checked: row.checked,
      onToggle: () => toggleAdded(row.id),
      onRemove: () => removeAdded(row.id),
    })),
    ...items.map((row) => ({
      row,
      place: pathBelow(row.path, location.path),
      checked: !excluded.has(row.id),
      onToggle: () => toggleListed(row.id),
    })),
  ];

  const visible = rows.slice(0, shown);

  return (
    <section aria-labelledby="labels-step-heading" className="flex flex-col gap-4">
      <h3 id="labels-step-heading" className="text-lg font-semibold">
        {t('labels.items.heading')}
      </h3>

      <QuickAdd inList={inList} onAdd={add} />

      {listed.isError ? (
        <ErrorState
          title={t('labels.items.loadError')}
          message={problemMessage(listed.error)}
          onRetry={() => void listed.refetch()}
        />
      ) : listed.data === undefined ? (
        <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p role="status" className={tooMany ? 'font-medium text-destructive' : 'font-medium'}>
              {tooMany
                ? t('labels.items.summaryLimit', {
                    selected: count.format(chosen),
                    total: count.format(total),
                    max: count.format(MAX_LABELS),
                  })
                : t('labels.items.summary', { selected: count.format(chosen), total: count.format(total) })}
            </p>
            <div className="flex">
              <Button
                variant="link"
                onClick={() =>
                  onChange({
                    ...selection,
                    excluded: [],
                    added: selection.added.map((row) => ({ ...row, checked: true })),
                  })
                }
              >
                {t('labels.items.selectAll')}
              </Button>
              <Button
                variant="link"
                onClick={() =>
                  onChange({
                    ...selection,
                    excluded: items.map((row) => row.id),
                    added: selection.added.map((row) => ({ ...row, checked: false })),
                  })
                }
              >
                {t('labels.items.selectNone')}
              </Button>
            </div>
          </div>
          {truncated && (
            <p className="text-sm text-muted-foreground">
              {t('labels.items.truncated', { shown: count.format(items.length), total: count.format(listed.data.total) })}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="rounded-xl border border-line bg-card px-6 py-8 text-center text-sm text-muted-foreground">
              {t('labels.items.empty')}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-card">
              <p className="border-b border-line bg-muted px-4 py-2.5 text-[13px] font-bold text-secondary-foreground md:px-5">
                {t('labels.items.listHeading', { total: count.format(rows.length) })}
              </p>
              {selection.added.length > 0 && (
                <h4 className="border-b border-line px-4 py-2 text-sm font-semibold md:px-5">
                  {t('labels.items.addedGroup', { count: selection.added.length })}
                </h4>
              )}
              {table ? (
                <TableRows rows={visible} />
              ) : (
                <ul aria-label={t('labels.items.listLabel')} className="divide-y">
                  {visible.map((props) => (
                    <CardRow key={props.row.id} {...props} />
                  ))}
                </ul>
              )}
              {rows.length > ROWS_PER_PAGE && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2 md:px-5">
                  <p className="text-sm text-muted-foreground">
                    {t('labels.items.shown', { shown: count.format(visible.length), total: count.format(rows.length) })}
                  </p>
                  {visible.length < rows.length && (
                    <Button variant="link" onClick={() => setShown(shown + ROWS_PER_PAGE)}>
                      {t('labels.items.showMore')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
