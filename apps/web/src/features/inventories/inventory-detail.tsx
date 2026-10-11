import type { InventoryDto, InventoryLocationDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack } from '@/components/avatar';
import { ErrorState } from '@/components/error-state';
import { Section } from '@/components/section';
import { ArchivedBadge } from '@/components/archived-badge';
import { Badge } from '@/components/ui/badge';
import { Progress, progressPercent } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { pathLabel } from '@/features/locations/path';
import { isMissingRecord } from '@/lib/api';
import { formatTime, formatTimestamp } from '@/lib/format';
import { problemMessage } from '@/lib/problem';
import { inventoryQueryOptions } from './api';
import { InventoryActions } from './inventory-actions';
import { InventoryBreadcrumb } from './inventory-breadcrumb';
import { SubLocationsBox } from './inventory-sublocations';
import { InventorySummary, progressOf, runFigures } from './inventory-summary';
import { shortName, shortNames } from './people';
import { ScanEntry } from './scan-entry';
import { statusBadge } from './status';

type Group = 'inProgress' | 'notStarted' | 'done';
const groups: Group[] = ['inProgress', 'notStarted', 'done'];

/**
 * Some checked: in progress. None: nobody started. Nothing left to check, each item of the list
 * checked or flagged as missing (found items count as work): done.
 */
function groupOf(location: InventoryLocationDto): Group {
  if (location.checked === 0 && location.extra === 0 && location.missing === 0) return 'notStarted';
  return location.checked + location.missing >= location.total ? 'done' : 'inProgress';
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

/**
 * The record of the run, oldest first, each line as "who · date v time" like the cards of the
 * Inventura tab: the start, then every finish, cancel and reopen. A reopen clears the end of the
 * run, so it is the history, not `endedAt`, that tells it was once cancelled.
 */
function RunLines({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const lines = [{ action: 'start' as const, at: inventory.startedAt, by: inventory.startedBy }, ...inventory.history];
  return (
    <div className="flex flex-col gap-1">
      {lines.map(({ action, at, by }) => {
        const when = { date: formatTimestamp(at), time: formatTime(at) };
        return (
          <p key={`${action}-${at}`} className="text-sm text-muted-foreground">
            {by
              ? t(`inventory.event.${action}.by`, { ...when, who: shortName(by) })
              : t(`inventory.event.${action}.on`, when)}
          </p>
        );
      })}
    </div>
  );
}

function Progression({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const figures = runFigures(inventory.counts);
  const { done, total } = progressOf(figures);
  return (
    <>
      {total === 0 ? (
        <p className="text-[15px] text-muted-foreground">{t('inventory.noItems')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-semibold">
            {t('inventory.progress', { done, total, percent: progressPercent(done, total) })}
          </p>
          <Progress value={done} max={total} label={t('inventory.progressLabel')} />
        </div>
      )}
      {/* An empty list with nothing found has nothing to add up. */}
      {total > 0 && <InventorySummary figures={figures} />}
    </>
  );
}

function LocationRow({ inventory, location, group }: { inventory: InventoryDto; location: InventoryLocationDto; group: Group }) {
  const { t } = useTranslation();
  const via = viaPath(inventory, location);
  return (
    <li>
      <Link
        to="/inventories/$id/locations/$locationId"
        params={{ id: inventory.id, locationId: location.id }}
        className="-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold break-words">{location.name}</p>
          {via && <p className="text-sm break-words text-muted-foreground">{via}</p>}
          <p className="text-sm text-muted-foreground">
            {[
              location.total > 0 && t('inventory.locations.items', { checked: location.checked, total: location.total }),
              location.extra > 0 && t('inventory.locations.extra', { count: location.extra }),
              location.missing > 0 && t('inventory.locations.missing', { count: location.missing }),
              group === 'notStarted' && t('inventory.locations.nobodyStarted'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {group === 'done' && <Badge variant="success">{t('inventory.locations.doneBadge')}</Badge>}
        <AvatarStack people={location.participants} />
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function InventoryBody({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const byGroup: Record<Group, InventoryLocationDto[]> = { inProgress: [], notStarted: [], done: [] };
  for (const location of inventory.locations) byGroup[groupOf(location)].push(location);

  return (
    <>
      {/* The buttons sit at the right end of the title's row; on a phone they wrap under the title. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <InventoryBreadcrumb inventory={inventory} path={inventory.path} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold break-words">{inventory.location.name}</h1>
            {inventory.status !== 'in_progress' && (
              <Badge variant={statusBadge[inventory.status]}>{t(`inventory.status.${inventory.status}`)}</Badge>
            )}
            {inventory.archivedAt && <ArchivedBadge />}
          </div>
        </div>
        {canWrite && <InventoryActions inventory={inventory} />}
      </div>

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <Progression inventory={inventory} />
        {inventory.activeNow.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('inventory.activeNow', { count: inventory.activeNow.length, who: shortNames(inventory.activeNow) })}
          </p>
        )}
        <RunLines inventory={inventory} />
      </section>

      <SubLocationsBox
        counts={{ notStarted: byGroup.notStarted.length, inProgress: byGroup.inProgress.length, done: byGroup.done.length }}
      />

      {groups.map((group) => {
        const locations = byGroup[group];
        if (locations.length === 0) return null;
        return (
          <Section key={group} title={t(`inventory.locations.${group}`)}>
            <ul className="-my-2 flex flex-col divide-y">
              {locations.map((location) => (
                <LocationRow key={location.id} inventory={inventory} location={location} group={group} />
              ))}
            </ul>
          </Section>
        );
      })}

      {canWrite && inventory.status === 'in_progress' && <ScanEntry inventoryId={inventory.id} withNote />}
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
