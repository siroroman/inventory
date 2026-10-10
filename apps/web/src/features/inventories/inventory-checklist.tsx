import type { InventoryDto, InventoryLocationDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Circle, CircleCheck } from 'lucide-react';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack } from '@/components/avatar';
import { BackButton } from '@/components/back-button';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/paged-list';
import { SearchBox } from '@/components/search-box';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, progressPercent } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { pathLabel } from '@/features/locations/path';
import { isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { inventoryItemsQueryOptions, inventoryQueryOptions } from './api';
import { ChecklistRow } from './checklist-row';
import { groupRows, recentCheckedCount } from './checklist';
import { statusBadge } from './status';
import { useTickItem } from './use-tick-item';

function ChecklistSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** A white card with a heading bar: the title on the left, how many rows on the right. */
function Group({ title, count, icon, children }: { title: string; count: number; icon: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-line bg-card">
      <h2
        id={headingId}
        className="flex items-center gap-2 border-b border-line bg-muted px-4 py-2.5 text-[13px] font-bold text-secondary-foreground md:px-5"
      >
        {icon}
        <span className="flex-1">{title}</span>
        <span>{count}</span>
      </h2>
      {children}
    </section>
  );
}

function ChecklistBody({
  inventory,
  location,
  q,
  onSearch,
}: {
  inventory: InventoryDto;
  location: InventoryLocationDto;
  q: string;
  onSearch: (text: string) => void;
}) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const inProgress = inventory.status === 'in_progress';
  // Read users and ended runs show the states without checkboxes.
  const canEdit = canWrite && inProgress;
  const rows = useQuery(inventoryItemsQueryOptions(inventory.id, location.id, inProgress));
  const { pending, tick } = useTickItem(inventory.id, location.id);
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupRows(rows.data?.items ?? [], q), [rows.data, q]);

  // From the run's root down to the location's parent (the location itself is the heading).
  const rootIndex = location.path.findIndex((segment) => segment.id === inventory.location.id);
  const above = location.path.slice(Math.max(rootIndex, 0), -1);

  // While searching every match is listed; otherwise only the newest checks, the rest on demand.
  const everyChecked = expanded || q !== '';
  const shownChecked = everyChecked ? groups.checked : groups.checked.slice(0, recentCheckedCount);
  const hiddenChecked = groups.checked.length - shownChecked.length;

  const renderRow = (row: (typeof groups.unchecked)[number]) => (
    <ChecklistRow
      key={row.id}
      row={row}
      canEdit={canEdit}
      pendingChecked={pending.get(row.id)}
      onToggle={(checked) => tick(row, checked)}
    />
  );

  let list: ReactNode;
  if (rows.data) {
    if (groups.unchecked.length === 0 && groups.checked.length === 0) {
      list = (
        <EmptyState
          title={q ? t('states.noResultsTitle') : t('inventory.checklist.emptyTitle')}
          hint={q ? t('states.noResultsHint') : t('inventory.checklist.emptyHint')}
        />
      );
    } else {
      list = (
        <>
          {groups.unchecked.length > 0 ? (
            <Group
              title={t('inventory.checklist.unchecked')}
              count={groups.unchecked.length}
              icon={<Circle aria-hidden className="size-[18px] text-muted-foreground" strokeWidth={2.4} />}
            >
              <ul>{groups.unchecked.map(renderRow)}</ul>
            </Group>
          ) : (
            !q && <p className="px-1 text-sm text-muted-foreground">{t('inventory.checklist.allChecked')}</p>
          )}
          {groups.checked.length > 0 && (
            <Group
              title={t('inventory.checklist.checked')}
              count={groups.checked.length}
              icon={<CircleCheck aria-hidden className="size-[18px] text-success" strokeWidth={2.4} />}
            >
              <ul>{shownChecked.map(renderRow)}</ul>
              {(hiddenChecked > 0 || (expanded && !q && groups.checked.length > recentCheckedCount)) && (
                <Button
                  variant="ghost"
                  className="w-full justify-start rounded-none px-4 text-muted-foreground md:px-5"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {hiddenChecked > 0
                    ? t('inventory.checklist.moreChecked', { count: hiddenChecked })
                    : t('inventory.checklist.showLess')}
                </Button>
              )}
            </Group>
          )}
        </>
      );
    }
  } else if (rows.isError) {
    list = <ErrorState message={problemMessage(rows.error)} onRetry={() => void rows.refetch()} />;
  } else {
    list = <ChecklistSkeleton />;
  }

  return (
    <>
      <BackButton
        fallback={(content) => (
          <Link to="/inventories/$id" params={{ id: inventory.id }}>
            {content}
          </Link>
        )}
      />

      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold break-words">{location.name}</h1>
          {above.length > 0 && <p className="text-sm break-words text-muted-foreground">{pathLabel(above)}</p>}
        </div>
        {!inProgress && (
          <Badge variant={statusBadge[inventory.status]} className="mt-2">
            {t(`inventory.status.${inventory.status}`)}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:flex-nowrap">
        <div className="flex min-w-48 flex-1 flex-col gap-2">
          <p className="text-[15px] font-semibold">
            {t('inventory.progress', {
              checked: location.checked,
              total: location.total,
              percent: progressPercent(location.checked, location.total),
            })}
          </p>
          <Progress value={location.checked} max={location.total} label={t('inventory.progressLabel')} />
        </div>
        <AvatarStack people={location.participants} />
        <div className="w-full md:w-72">
          <SearchBox
            value={q}
            onSearch={onSearch}
            label={t('inventory.checklist.searchLabel')}
            placeholder={t('inventory.checklist.searchPlaceholder')}
          />
        </div>
      </div>

      {list}
    </>
  );
}

/**
 * The checklist of one location of a run: the items to find there, unchecked first. Writers tick
 * them; the screen follows the others' ticks on its own while the run is in progress.
 */
export function InventoryChecklist({
  id,
  locationId,
  q,
  onSearch,
}: {
  id: string;
  locationId: string;
  q: string;
  onSearch: (text: string) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery(inventoryQueryOptions(id));
  const location = query.data?.locations.find((candidate) => candidate.id === locationId);

  let body: ReactNode;
  if (query.data && location) {
    body = <ChecklistBody inventory={query.data} location={location} q={q} onSearch={onSearch} />;
  } else if (query.data) {
    // A location without rows in the run (or another run's) has no checklist.
    body = (
      <ErrorState title={t('inventory.checklist.notFoundTitle')} message={t('inventory.checklist.notFoundHint')}>
        <Button asChild variant="outline" className="mt-1">
          <Link to="/inventories/$id" params={{ id }}>
            {t('inventory.checklist.toOverview')}
          </Link>
        </Button>
      </ErrorState>
    );
  } else if (query.isError) {
    body = isMissingRecord(query.error) ? (
      <ErrorState title={t('inventory.notFoundTitle')} message={t('inventory.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else {
    body = <ChecklistSkeleton />;
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">{body}</div>;
}
