import type { LocationDto } from '@inventory/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { PagedList } from '@/components/paged-list';
import { RouteNotFound, RoutePending } from '@/components/route-states';
import { Badge } from '@/components/ui/badge';
import { useItemRows } from '@/features/items/item-list';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { locationChildrenQueryOptions, locationItemsQueryOptions, locationQueryOptions } from './api';
import { useLocationRows } from './location-list';

/** A link in the detail's header or fields: at least 44 px tall to tap. */
const crumbLink =
  'inline-flex min-h-11 items-center rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring';
const sectionHeading = 'px-4 pb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase';

/** The way up: every ancestor links to its own detail, the location itself is the current page. */
function Breadcrumb({ path }: { path: LocationDto['path'] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('locationDetail.breadcrumb')}>
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

/** A titled list on the detail page. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="pt-8">
      <h2 id={id} className={sectionHeading}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubLocations({ location }: { location: LocationDto }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({ ...locationChildrenQueryOptions(location.id), enabled: location.childCount > 0 });
  const { columns, card } = useLocationRows({ nested: true });
  // A location without sub-locations (most of them) has no section rather than an empty one.
  if (location.childCount === 0) return null;
  return (
    <Section id="sub-locations" title={t('locationDetail.subLocations', { count: location.childCount })}>
      <PagedList
        query={query}
        searching={false}
        empty={{ title: t('home.locations.emptyTitle'), hint: t('home.locations.emptyHint') }}
        columns={columns}
        card={card}
      />
    </Section>
  );
}

function Items({ location }: { location: LocationDto }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(locationItemsQueryOptions(location.id));
  const { columns, card } = useItemRows();
  return (
    <Section id="location-items" title={t('locationDetail.items', { count: location.itemCount })}>
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

/** Read-only detail of one location: where it is, its fields, its sub-locations and its items. */
export function LocationDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(locationQueryOptions(id));

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
  return (
    <div className="mx-auto w-full max-w-6xl pb-8">
      <header className="flex flex-col px-4 pt-2 pb-4">
        <Breadcrumb path={location.path} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">{location.name}</h1>
          {location.archivedAt && <Badge variant="warning">{t('locationDetail.archived')}</Badge>}
        </div>
      </header>
      <dl className="flex flex-col gap-3 px-4">
        <Field label={t('locationDetail.fields.code')}>{location.code}</Field>
        <Field label={t('locationDetail.fields.parent')}>
          {parent && (
            <Link to="/locations/$id" params={{ id: parent.id }} className={cn(crumbLink, 'text-primary')}>
              {parent.name}
            </Link>
          )}
        </Field>
        {!location.parentId && <Field label={t('locationDetail.fields.type')}>{location.type?.name}</Field>}
        <Field label={t('locationDetail.fields.address')}>{location.address}</Field>
        <Field label={t('locationDetail.fields.note')}>{location.note}</Field>
      </dl>
      <SubLocations location={location} />
      <Items location={location} />
    </div>
  );
}
