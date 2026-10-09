import type { InventoryListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AvatarStack } from '@/components/avatar';
import { BottomBar } from '@/components/bottom-bar';
import { ListFrame, ListToolbar } from '@/components/list-toolbar';
import { type Column, EmptyState, PagedList, pagedTotal } from '@/components/paged-list';
import { sectionTitleClass } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useCanWrite } from '@/features/auth/use-can-write';
import { pathLabel } from '@/features/locations/path';
import { formatTime, formatTimestamp } from '@/lib/format';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';
import { inventoryListQueryOptions } from './api';
import { shortName } from './people';

const statusBadge = { in_progress: 'info', finished: 'success', cancelled: 'neutral' } as const;

/** What a finished run found ("120 nalezeno · 3 jinde · 5 nezvěstných"), or how far a cancelled one got. */
function useResultLine() {
  const { t } = useTranslation();
  return ({ status, counts }: InventoryListEntryDto) => {
    if (status === 'cancelled') {
      return t('home.inventory.result.cancelled', { checked: counts.checked, expected: counts.expected });
    }
    return [
      t('home.inventory.result.found', { count: counts.checked }),
      counts.elsewhere > 0 && t('home.inventory.result.elsewhere', { count: counts.elsewhere }),
      counts.missing > 0 && t('home.inventory.result.missing', { count: counts.missing }),
    ]
      .filter(Boolean)
      .join(' · ');
  };
}

/** A run in progress: where, how far, who started it and who took part, and the way in. */
function OpenCard({ run }: { run: InventoryListEntryDto }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const { expected, checked } = run.counts;
  const above = run.path.slice(0, -1);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold break-words">{run.location.name}</p>
          {above.length > 0 && <p className="text-sm break-words text-muted-foreground">{pathLabel(above)}</p>}
        </div>
        <Button asChild size="sm" variant={canWrite ? 'default' : 'outline'}>
          <Link to="/inventories/$id" params={{ id: run.id }}>
            {canWrite ? t('home.inventory.continue') : t('home.inventory.view')}
          </Link>
        </Button>
      </div>
      {expected > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">
            {t('inventory.progress', { checked, total: expected, percent: Math.round((checked / expected) * 100) })}
          </p>
          <Progress value={checked} max={expected} label={t('inventory.progressLabel')} />
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
  );
}

function ClosedCard({ run, result }: { run: InventoryListEntryDto; result: string }) {
  const { t } = useTranslation();
  return (
    <Link to="/inventories/$id" params={{ id: run.id }} className="block">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] font-semibold break-words">{run.location.name}</p>
        <Badge variant={statusBadge[run.status]} className="mt-0.5">
          {t(`inventory.status.${run.status}`)}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {[run.endedAt && formatTimestamp(run.endedAt), run.startedBy && t('home.inventory.startedBy', { who: shortName(run.startedBy) })]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="text-sm text-muted-foreground">{result}</p>
    </Link>
  );
}

/** A heading with the count above a list, aligned with the framed list below it; no count until it is known. */
function SectionHeading({ title, total }: { title: string; total: number | undefined }) {
  return <h2 className={`${sectionTitleClass} px-4 pb-2 lg:px-8`}>{total === undefined ? title : `${title} (${total})`}</h2>;
}

/**
 * Inventura tab: the runs in progress as cards, then the finished and cancelled ones (a table on a
 * wide screen), newest first. The search looks at the root location. Writers start a run from the
 * button beside the heading (desktop) or in the bar at the bottom (phone).
 */
export function InventoryPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const desktop = useMediaQuery(desktopScreen);
  const resultLine = useResultLine();
  const open = useInfiniteQuery(inventoryListQueryOptions('open', q));
  const closed = useInfiniteQuery(inventoryListQueryOptions('closed', q));
  const openTotal = pagedTotal(open.data);
  const closedTotal = pagedTotal(closed.data);

  const start = (className?: string) => (
    <Button asChild className={className}>
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
      cell: (run) => (
        <Link to="/inventories/$id" params={{ id: run.id }} title={pathLabel(run.path)} className="hover:underline">
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
    open.data && closed.data && !open.isPlaceholderData && !closed.isPlaceholderData && openTotal === 0 && closedTotal === 0;

  return (
    <>
      <ListToolbar
        title={t('home.inventory.tab')}
        action={canWrite && desktop ? start() : undefined}
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
              {canWrite && <div className="flex justify-center pb-8">{start()}</div>}
            </>
          )}
        </ListFrame>
      ) : (
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
          <SectionHeading title={t('home.inventory.closed')} total={closedTotal} />
          <ListFrame>
            <PagedList
              query={closed}
              searching={q !== ''}
              empty={{ title: t('home.inventory.noClosedTitle'), hint: t('home.inventory.noClosedHint') }}
              columns={columns}
              card={(run) => <ClosedCard run={run} result={resultLine(run)} />}
            />
          </ListFrame>
        </>
      )}
      {canWrite && !desktop && <BottomBar>{start('w-full')}</BottomBar>}
    </>
  );
}
