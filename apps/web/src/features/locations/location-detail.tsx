import type { LocationDto } from '@inventory/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Pencil, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveControl } from '@/components/archive-control';
import { ArchivedBadge } from '@/components/archived-badge';
import { ErrorState } from '@/components/error-state';
import { EmptyState, PagedList } from '@/components/paged-list';
import { RouteNotFound, RoutePending } from '@/components/route-states';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/features/auth/use-can-write';
import { useItemRows } from '@/features/items/item-list';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  archiveLocation,
  locationChildrenQueryOptions,
  locationItemsQueryOptions,
  locationQueryOptions,
  restoreLocation,
} from './api';
import { useLocationRows } from './location-list';

/** A link in the detail's header or fields: at least 44 px tall to tap. */
const crumbLink =
  'inline-flex min-h-11 items-center rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring';
const sectionHeading = 'mx-4 pb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase';

/** The way up: every ancestor links to its own detail, the location itself is the current page. */
function Breadcrumb({ path }: { path: LocationDto['path'] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('locationDetail.breadcrumb')} className="mb-1">
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        <li>
          <Link to="/" className={crumbLink}>
            {t('home.locations.tab')}
          </Link>
        </li>
        {path.map((segment, index) => (
          <li key={segment.id} className="flex items-center gap-x-1">
            <ChevronRight aria-hidden className="size-3.5" />
            {index === path.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {segment.name}
              </span>
            ) : (
              <Link
                to="/locations/$id"
                params={{ id: segment.id }}
                className={crumbLink}
              >
                {segment.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="text-sm whitespace-pre-line">{children || t('common.empty')}</dd>
    </div>
  );
}

/** A titled list on the detail page, in the same box as the fields. */
function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="pt-8">
      <div className="mx-4 flex items-center justify-between gap-3 pb-4">
        <h2 id={id} className={cn(sectionHeading, 'mx-0 pb-0')}>
          {title}
        </h2>
        {action}
      </div>
      {children && <div className="mx-4 overflow-hidden rounded-lg border bg-card">{children}</div>}
    </section>
  );
}

/** A blue "add" button for a section; only writers see it, and not on an archived location. */
function AddButton({ children }: { children: ReactNode }) {
  return (
    <Button asChild size="sm">
      {children}
    </Button>
  );
}

function SubLocations({ location, canAdd }: { location: LocationDto; canAdd: boolean }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({ ...locationChildrenQueryOptions(location.id), enabled: location.childCount > 0 });
  const { columns, card } = useLocationRows({ nested: true });
  // A location without sub-locations (most of them) has no section, unless the user can add one.
  if (location.childCount === 0 && !canAdd) return null;
  return (
    <Section
      id="sub-locations"
      title={t('locationDetail.subLocations', { count: location.childCount })}
      action={
        canAdd && (
          <AddButton>
            <Link to="/locations/new" search={{ parentId: location.id }}>
              <Plus aria-hidden />
              {t('locationDetail.addSubLocation')}
            </Link>
          </AddButton>
        )
      }
    >
      {location.childCount > 0 ? (
        <PagedList
          query={query}
          searching={false}
          empty={{ title: t('home.locations.emptyTitle'), hint: t('home.locations.emptyHint') }}
          columns={columns}
          card={card}
        />
      ) : (
        <EmptyState title={t('locationDetail.subLocationsEmptyTitle')} hint={t('locationDetail.subLocationsEmptyHint')} />
      )}
    </Section>
  );
}

function Items({ location, canAdd }: { location: LocationDto; canAdd: boolean }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(locationItemsQueryOptions(location.id));
  const { columns, card } = useItemRows();
  return (
    <Section
      id="location-items"
      title={t('locationDetail.items', { count: location.itemCount })}
      action={
        canAdd && (
          <AddButton>
            <Link to="/items/new" search={{ locationId: location.id }}>
              <Plus aria-hidden />
              {t('home.items.add')}
            </Link>
          </AddButton>
        )
      }
    >
      <PagedList
        query={query}
        searching={false}
        empty={{ title: t('locationDetail.itemsEmptyTitle'), hint: t('locationDetail.itemsEmptyHint') }}
        columns={columns}
        card={card}
      />
    </Section>
  );
}

/** What else disappears from the lists when this location is archived; nothing when it is empty. */
function HiddenWithIt({ location }: { location: LocationDto }) {
  const { t, i18n } = useTranslation();
  const parts = [
    location.childCount > 0 && t('common.subLocationCount', { count: location.childCount }),
    location.itemCount > 0 && t('common.itemCount', { count: location.itemCount }),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p>{t('locationDetail.archiveContents', { what: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(parts as string[]) })}</p>;
}

/** Detail of one location: where it is, its fields, its sub-locations and its items. */
export function LocationDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(locationQueryOptions(id));
  const canWrite = useCanWrite();

  if (query.isPending) return <RoutePending />;
  if (query.isError) {
    // A stale link or a mistyped id: the page does not exist, retrying will not help.
    if (query.error instanceof ApiError && ['not_found', 'validation_error'].includes(query.error.code)) {
      return <RouteNotFound />;
    }
    return <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />;
  }

  const location = query.data;
  const parent = location.path.at(-2);
  const canAdd = canWrite && !location.archivedAt;
  return (
    <div className="mx-auto w-full max-w-6xl pb-8">
      <header className="flex flex-col px-4 pt-2 pb-4">
        <Breadcrumb path={location.path} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold">{location.name}</h1>
            {location.archivedAt && <ArchivedBadge />}
          </div>
          {canWrite && (
            <div className="flex items-center gap-2">
              {/* An archived location is read-only until it is restored. */}
              {canAdd && (
                <Button asChild size="sm">
                  <Link to="/locations/$id/edit" params={{ id: location.id }}>
                    <Pencil aria-hidden />
                    {t('locationDetail.edit')}
                  </Link>
                </Button>
              )}
              <ArchiveControl
                archived={Boolean(location.archivedAt)}
                archive={() => archiveLocation(location.id, location.version)}
                restore={() => restoreLocation(location.id, location.version)}
                title={t('locationDetail.archiveTitle')}
                description={
                  <>
                    <p>{t('locationDetail.archiveHint')}</p>
                    <HiddenWithIt location={location} />
                  </>
                }
              />
            </div>
          )}
        </div>
      </header>
      <dl className="mx-4 flex flex-col gap-3 rounded-lg border bg-card p-4">
        <Field label={t('locationDetail.fields.code')}>{location.code}</Field>
        <Field label={t('locationDetail.fields.parent')}>
          {parent && (
            <Link to="/locations/$id" params={{ id: parent.id }} className={cn(crumbLink, '-my-3 underline underline-offset-2')}>
              {parent.name}
            </Link>
          )}
        </Field>
        {!location.parentId && <Field label={t('locationDetail.fields.type')}>{location.type?.name}</Field>}
        <Field label={t('locationDetail.fields.address')}>{location.address}</Field>
        <Field label={t('locationDetail.fields.note')}>{location.note}</Field>
      </dl>
      <SubLocations location={location} canAdd={canAdd} />
      <Items location={location} canAdd={canAdd} />
    </div>
  );
}
