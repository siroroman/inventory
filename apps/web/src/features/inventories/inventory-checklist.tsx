import type { InventoryDto, InventoryLocationDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Circle, CircleCheck, CirclePlus, Plus, SearchX } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { inventoryItemsQueryOptions, inventoryQueryOptions } from './api';
import { ChecklistRow } from './checklist-row';
import { groupRows } from './checklist';
import { InventorySummary, locationFigures, progressOf } from './inventory-summary';
import { ScanEntry } from './scan-entry';
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

type SectionKey = 'unchecked' | 'missing' | 'checked' | 'added';

/**
 * A white card with a heading bar: the title on the left, how many rows on the right. The bar is a
 * button that folds the rows away (`open`); while a search is on, the card is not foldable and its
 * rows are always listed, so a match cannot hide in a closed section.
 */
function Group({
  title,
  count,
  icon,
  open,
  foldable,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  open: boolean;
  foldable: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const contentId = useId();
  const barClass = cn(
    'flex w-full items-center gap-2 bg-muted px-4 py-2.5 text-left text-[13px] font-bold text-secondary-foreground md:px-5',
    open && 'border-b border-line',
  );
  const bar = (
    <>
      {icon}
      <span className="flex-1">{title}</span>
      <span>{count}</span>
    </>
  );
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-line bg-card">
      <h2 id={headingId} className="m-0">
        {foldable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={onToggle}
            className={cn(barClass, 'min-h-11 cursor-pointer outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset')}
          >
            {bar}
            <ChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')} />
          </button>
        ) : (
          <div className={barClass}>{bar}</div>
        )}
      </h2>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
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
  const figures = locationFigures(location);
  const { done, total } = progressOf(figures);
  const rows = useQuery(inventoryItemsQueryOptions(inventory.id, location.id, inProgress));
  const { pending, tick, flag } = useTickItem(inventory.id, location.id);
  // The sections start folded (the summary above tells how many rows each holds).
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    unchecked: false,
    missing: false,
    checked: false,
    added: false,
  });
  const searching = q !== '';
  const toggle = (key: SectionKey) => setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  const groups = useMemo(() => groupRows(rows.data?.items ?? [], q), [rows.data, q]);

  // From the run's root down to the location's parent (the location itself is the heading).
  const rootIndex = location.path.findIndex((segment) => segment.id === inventory.location.id);
  const above = location.path.slice(Math.max(rootIndex, 0), -1);

  const renderRow = (row: (typeof groups.unchecked)[number]) => (
    <ChecklistRow
      key={row.id}
      row={row}
      canEdit={canEdit}
      pending={pending.get(row.id)}
      onToggle={(checked) => tick(row, checked)}
      onToggleMissing={(missing) => flag(row, missing)}
    />
  );

  let list: ReactNode;
  if (rows.data) {
    if (
      groups.unchecked.length === 0 &&
      groups.missing.length === 0 &&
      groups.checked.length === 0 &&
      groups.added.length === 0
    ) {
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
              open={searching || openSections.unchecked}
              foldable={!searching}
              onToggle={() => toggle('unchecked')}
            >
              <ul>{groups.unchecked.map(renderRow)}</ul>
            </Group>
          ) : (
            !searching &&
            groups.missing.length === 0 &&
            groups.checked.length > 0 && (
              <p className="px-1 text-sm text-muted-foreground">{t('inventory.checklist.allChecked')}</p>
            )
          )}
          {groups.missing.length > 0 && (
            <Group
              title={t('inventory.checklist.missing')}
              count={groups.missing.length}
              icon={<SearchX aria-hidden className="size-[18px] text-destructive" strokeWidth={2.4} />}
              open={searching || openSections.missing}
              foldable={!searching}
              onToggle={() => toggle('missing')}
            >
              <ul>{groups.missing.map(renderRow)}</ul>
            </Group>
          )}
          {groups.checked.length > 0 && (
            <Group
              title={t('inventory.checklist.checked')}
              count={groups.checked.length}
              icon={<CircleCheck aria-hidden className="size-[18px] text-success" strokeWidth={2.4} />}
              open={searching || openSections.checked}
              foldable={!searching}
              onToggle={() => toggle('checked')}
            >
              <ul>{groups.checked.map(renderRow)}</ul>
            </Group>
          )}
          {groups.added.length > 0 && (
            <Group
              title={t('inventory.checklist.added')}
              count={groups.added.length}
              icon={<CirclePlus aria-hidden className="size-[18px] text-primary" strokeWidth={2.4} />}
              open={searching || openSections.added}
              foldable={!searching}
              onToggle={() => toggle('added')}
            >
              <ul>{groups.added.map(renderRow)}</ul>
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
        {canEdit && (
          // The item form starts in this location and, once saved, adds the item to the run and returns here.
          <Button asChild>
            <Link to="/items/new" search={{ locationId: location.id, inventoryId: inventory.id }}>
              <Plus aria-hidden />
              {t('inventory.checklist.addItem')}
            </Link>
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:flex-nowrap">
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <p className="text-[15px] font-semibold">
              {t('inventory.progress', { done, total, percent: progressPercent(done, total) })}
            </p>
            <Progress value={done} max={total} label={t('inventory.progressLabel')} />
          </div>
          <AvatarStack people={location.participants} />
        </div>
        <InventorySummary figures={figures} />
      </section>

      <SearchBox
        value={q}
        onSearch={onSearch}
        label={t('inventory.checklist.searchLabel')}
        placeholder={t('inventory.checklist.searchPlaceholder')}
      />

      {list}

      {canEdit && <ScanEntry inventoryId={inventory.id} locationId={location.id} />}
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
