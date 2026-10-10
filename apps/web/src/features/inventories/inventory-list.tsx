import type { InventoryListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { AvatarStack } from '@/components/avatar';
import { ListFrame, ListToolbar } from '@/components/list-toolbar';
import { type Column, EmptyState, PagedList, pagedTotal, rowLinkClass } from '@/components/paged-list';
import { sectionTitleClass } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, progressPercent } from '@/components/ui/progress';
import { useCanWrite } from '@/features/auth/use-can-write';
import { pathLabel } from '@/features/locations/path';
import { formatTime, formatTimestamp } from '@/lib/format';
import { inventoryListQueryOptions } from './api';
import { progressOf, runFigures } from './inventory-summary';
import { shortName } from './people';
import { statusBadge } from './status';

/** What a finished run found ("120 nalezeno · 3 jinde · 5 chybí · 2 nezkontrolováno"), or how far a cancelled one got. */
function useResultLine() {
  const { t } = useTranslation();
  return ({ status, counts }: InventoryListEntryDto) => {
    if (status === 'cancelled') {
      return t('home.inventory.result.cancelled', { checked: counts.checked, expected: counts.expected });
    }
    // What the finish left: the list without what was found or flagged as missing.
    const { unchecked } = runFigures(counts);
    return [
      t('home.inventory.result.found', { count: counts.checked }),
      counts.elsewhere > 0 && t('home.inventory.result.elsewhere', { count: counts.elsewhere }),
      counts.missing > 0 && t('home.inventory.result.missing', { count: counts.missing }),
      unchecked > 0 && t('home.inventory.result.unchecked', { count: unchecked }),
    ]
      .filter(Boolean)
      .join(' · ');
  };
}

/**
 * A whole card of a list is the link to the run: it stretches over the padding of the list item,
 * so a tap anywhere on the card opens it.
 */
function RunLink({ run, children }: { run: InventoryListEntryDto; children: ReactNode }) {
  return (
    <Link
      to="/inventories/$id"
      params={{ id: run.id }}
      className="-mx-4 -my-3 block px-4 py-3 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
    >
      {children}
    </Link>
  );
}

/** A run in progress: where, how far, who started it and who took part. The whole card opens it. */
function OpenCard({ run }: { run: InventoryListEntryDto }) {
  const { t } = useTranslation();
  const { done, total } = progressOf(runFigures(run.counts));
  const above = run.path.slice(0, -1);
  return (
    <RunLink run={run}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold break-words">{run.location.name}</p>
            {above.length > 0 && <p className="text-sm break-words text-muted-foreground">{pathLabel(above)}</p>}
          </div>
          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        {total > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm">
              {t('inventory.progress', { done, total, percent: progressPercent(done, total) })}
            </p>
            <Progress value={done} max={total} label={t('inventory.progressLabel')} />
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {run.startedBy
              ? t('home.inventory.startedOn', {
                  who: shortName(run.startedBy),
                  date: formatTimestamp(run.startedAt),
                  time: formatTime(run.startedAt),
                })
              : `${formatTimestamp(run.startedAt)} ${formatTime(run.startedAt)}`}
          </p>
          <AvatarStack people={run.participants} />
        </div>
      </div>
    </RunLink>
  );
}

function ClosedCard({ run, result }: { run: InventoryListEntryDto; result: string }) {
  const { t } = useTranslation();
  return (
    <RunLink run={run}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] font-semibold break-words">{run.location.name}</p>
        <span className="mt-0.5 flex shrink-0 flex-wrap justify-end gap-1.5">
          {run.archivedAt && <ArchivedBadge />}
          <Badge variant={statusBadge[run.status]}>{t(`inventory.status.${run.status}`)}</Badge>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {[run.endedAt && formatTimestamp(run.endedAt), run.startedBy && t('home.inventory.startedBy', { who: shortName(run.startedBy) })]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="text-sm text-muted-foreground">{result}</p>
    </RunLink>
  );
}

/** A heading with the count above a list, aligned with the framed list below it; no count until it is known. */
function SectionHeading({ title, total }: { title: string; total: number | undefined }) {
  return <h2 className={`${sectionTitleClass} px-4 pb-2 lg:px-8`}>{total === undefined ? title : `${title} (${total})`}</h2>;
}

/**
 * Inventura tab: the runs in progress as cards, then the finished and cancelled ones (a table on a
 * wide screen), newest first. The search looks at the root location. Writers start a run from the
 * button beside the heading, on a phone as well as on a desktop. "Zobrazit archivované" swaps both
 * lists for the archived runs (only an ended run can be archived); they open the detail, where
 * Obnovit is.
 */
export function InventoryPanel({
  q,
  onSearch,
  archived,
  onArchived,
}: {
  q: string;
  onSearch: (text: string) => void;
  /** Whether the archived runs are listed instead of the active ones. */
  archived: boolean;
  onArchived: (archived: boolean) => void;
}) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const resultLine = useResultLine();
  // A run in progress is never archived, so its list is not asked for in the archive.
  const open = useInfiniteQuery({ ...inventoryListQueryOptions('open', q), enabled: !archived });
  const closed = useInfiniteQuery(inventoryListQueryOptions('closed', q, archived));
  const openTotal = pagedTotal(open.data);
  const closedTotal = pagedTotal(closed.data);

  const start = (
    <Button asChild>
      <Link to="/inventories/new">
        <Plus aria-hidden />
        {t('home.inventory.start')}
      </Link>
    </Button>
  );

  const columns: Column<InventoryListEntryDto>[] = [
    {
      header: t('home.inventory.columns.location'),
      primary: true,
      // No Archivováno badge in the table: its name column is narrow, and the list is headed
      // "Archivované" anyway. The cards, which have the room, carry it. The link covers the row.
      cell: (run) => (
        <Link
          to="/inventories/$id"
          params={{ id: run.id }}
          title={pathLabel(run.path)}
          data-row-link
          className={`hover:underline ${rowLinkClass}`}
        >
          {run.location.name}
        </Link>
      ),
    },
    { header: t('home.inventory.columns.date'), className: 'w-36', cell: (run) => run.endedAt && formatTimestamp(run.endedAt) },
    {
      header: t('home.inventory.columns.result'),
      cell: (run) => <span title={resultLine(run)}>{resultLine(run)}</span>,
    },
    {
      header: t('home.inventory.columns.status'),
      className: 'w-36',
      cell: (run) => <Badge variant={statusBadge[run.status]}>{t(`inventory.status.${run.status}`)}</Badge>,
    },
  ];

  // Nothing at all (not even for the search): one welcome, not two empty lists.
  const nothingYet =
    !archived &&
    open.data &&
    closed.data &&
    !open.isPlaceholderData &&
    !closed.isPlaceholderData &&
    openTotal === 0 &&
    closedTotal === 0;

  return (
    <>
      <ListToolbar
        title={t('home.inventory.tab')}
        action={canWrite ? start : undefined}
        archived={{ checked: archived, onChange: onArchived, label: t('home.showArchived') }}
        search={{
          value: q,
          onSearch,
          label: t('home.inventory.searchLabel'),
          placeholder: t('home.inventory.searchPlaceholder'),
        }}
      />
      {nothingYet ? (
        <ListFrame>
          {q ? (
            <EmptyState title={t('states.noResultsTitle')} hint={t('states.noResultsHint')} />
          ) : (
            <>
              <EmptyState title={t('home.inventory.emptyTitle')} hint={t('home.inventory.emptyHint')} />
              {canWrite && <div className="flex justify-center pb-8">{start}</div>}
            </>
          )}
        </ListFrame>
      ) : (
        <>
          {!archived && (
            <>
              <SectionHeading title={t('home.inventory.open')} total={openTotal} />
              <ListFrame>
                <PagedList
                  query={open}
                  searching={q !== ''}
                  empty={{ title: t('home.inventory.noOpenTitle'), hint: t('home.inventory.noOpenHint') }}
                  card={(run) => <OpenCard run={run} />}
                />
              </ListFrame>
            </>
          )}
          <SectionHeading title={archived ? t('home.inventory.archived') : t('home.inventory.closed')} total={closedTotal} />
          <ListFrame>
            <PagedList
              query={closed}
              searching={q !== ''}
              empty={
                archived
                  ? { title: t('home.inventory.archivedEmptyTitle'), hint: t('home.archivedEmptyHint') }
                  : { title: t('home.inventory.noClosedTitle'), hint: t('home.inventory.noClosedHint') }
              }
              columns={columns}
              card={(run) => <ClosedCard run={run} result={resultLine(run)} />}
            />
          </ListFrame>
        </>
      )}
    </>
  );
}
