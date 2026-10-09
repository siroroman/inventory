import type { InventoryDto, InventoryLocationDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack } from '@/components/avatar';
import { BackButton } from '@/components/back-button';
import { ErrorState } from '@/components/error-state';
import { Section } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Progress, progressPercent } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { pathLabel } from '@/features/locations/path';
import { isMissingRecord } from '@/lib/api';
import { formatTime, formatTimestamp } from '@/lib/format';
import { problemMessage } from '@/lib/problem';
import { inventoryQueryOptions } from './api';
import { CancelInventory } from './cancel-inventory';
import { shortName, shortNames } from './people';
import { statusBadge } from './status';

type Group = 'inProgress' | 'notStarted' | 'done';
const groups: Group[] = ['inProgress', 'notStarted', 'done'];

/** Some checked: in progress. None: nobody started. All: done. */
function groupOf(location: InventoryLocationDto): Group {
  if (location.checked === 0) return 'notStarted';
  return location.checked >= location.total ? 'done' : 'inProgress';
}

/**
 * The locations between the run's root and a location ("Patro 2" for Zasedačka on the second
 * floor), so rooms with the same name on different floors stay apart. Nothing for the root itself
 * and for its direct children.
 */
function viaPath(inventory: InventoryDto, location: InventoryLocationDto): string | null {
  const rootIndex = location.path.findIndex((segment) => segment.id === inventory.location.id);
  const between = rootIndex < 0 ? [] : location.path.slice(rootIndex + 1, -1);
  return between.length > 0 ? pathLabel(between) : null;
}

function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** When the run started and by whom, or, for a cancelled one, when and by whom it was cancelled. */
function RunLines({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const date = formatTimestamp(inventory.startedAt);
  const cancelled = inventory.status === 'cancelled' && inventory.endedAt;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {inventory.startedBy
          ? t('inventory.startedBy', { date, who: shortName(inventory.startedBy) })
          : t('inventory.startedOn', { date })}
      </p>
      {cancelled && (
        <p className="text-sm text-muted-foreground">
          {inventory.endedBy
            ? t('inventory.cancelledBy', {
                who: shortName(inventory.endedBy),
                date: formatTimestamp(inventory.endedAt!),
                time: formatTime(inventory.endedAt!),
              })
            : t('inventory.cancelledOn', {
                date: formatTimestamp(inventory.endedAt!),
                time: formatTime(inventory.endedAt!),
              })}
        </p>
      )}
    </>
  );
}

function Progression({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const { expected, checked } = inventory.counts;
  if (expected === 0) return <p className="text-[15px] text-muted-foreground">{t('inventory.noItems')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] font-semibold">
        {t('inventory.progress', { checked, total: expected, percent: progressPercent(checked, expected) })}
      </p>
      <Progress value={checked} max={expected} label={t('inventory.progressLabel')} />
    </div>
  );
}

function LocationRow({ inventory, location, group }: { inventory: InventoryDto; location: InventoryLocationDto; group: Group }) {
  const { t } = useTranslation();
  const via = viaPath(inventory, location);
  return (
    <li className="flex min-h-11 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold break-words">{location.name}</p>
        {via && <p className="text-sm break-words text-muted-foreground">{via}</p>}
        <p className="text-sm text-muted-foreground">
          {t('inventory.locations.items', { checked: location.checked, total: location.total })}
          {group === 'notStarted' && ` · ${t('inventory.locations.nobodyStarted')}`}
        </p>
      </div>
      {group === 'done' && <Badge variant="success">{t('inventory.locations.doneBadge')}</Badge>}
      <AvatarStack people={location.participants} />
    </li>
  );
}

function InventoryBody({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const above = inventory.path.slice(0, -1);
  const byGroup: Record<Group, InventoryLocationDto[]> = { inProgress: [], notStarted: [], done: [] };
  for (const location of inventory.locations) byGroup[groupOf(location)].push(location);

  return (
    <>
      <BackButton fallback={(content) => <Link to="/" search={{ tab: 'inventory' }}>{content}</Link>} />

      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold break-words">{inventory.location.name}</h1>
          {above.length > 0 && <p className="text-sm break-words text-muted-foreground">{pathLabel(above)}</p>}
        </div>
        <Badge variant={statusBadge[inventory.status]} className="mt-2">
          {t(`inventory.status.${inventory.status}`)}
        </Badge>
        {canWrite && inventory.status === 'in_progress' && <CancelInventory inventory={inventory} />}
      </div>

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <RunLines inventory={inventory} />
        <Progression inventory={inventory} />
        {inventory.activeNow.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('inventory.activeNow', { count: inventory.activeNow.length, who: shortNames(inventory.activeNow) })}
          </p>
        )}
        {inventory.participants.length > 0 && (
          <div className="flex items-center gap-2">
            <AvatarStack people={inventory.participants} />
          </div>
        )}
      </section>

      {groups.map((group) => {
        const locations = byGroup[group];
        if (locations.length === 0) return null;
        return (
          <Section key={group} title={t(`inventory.locations.${group}`, { count: locations.length })}>
            <ul className="-my-2 flex flex-col divide-y">
              {locations.map((location) => (
                <LocationRow key={location.id} inventory={inventory} location={location} group={group} />
              ))}
            </ul>
          </Section>
        );
      })}
    </>
  );
}

/** A run: how far it is, who works on it and, by location, what is done. A run in progress refreshes on its own. */
export function InventoryDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(inventoryQueryOptions(id));

  let body: ReactNode;
  if (query.data) {
    body = <InventoryBody inventory={query.data} />;
  } else if (query.isError) {
    // A missing run (or an id that is no id at all) will not appear on a retry.
    body = isMissingRecord(query.error) ? (
      <ErrorState title={t('inventory.notFoundTitle')} message={t('inventory.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else {
    body = <DetailSkeleton />;
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">{body}</div>;
}
