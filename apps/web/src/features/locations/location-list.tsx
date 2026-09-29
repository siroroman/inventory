import type { LocationDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { locationListQueryOptions } from './api';

/** A search also finds sub-locations; their name alone would not say where they are. */
function parentPath(location: LocationDto): string {
  return location.path
    .slice(0, -1)
    .map((segment) => segment.name)
    .join(' › ');
}

/** The name of a location as a link to its detail; on a card the link covers the whole row. */
function LocationLink({ location, card, children }: { location: LocationDto; card?: boolean; children: ReactNode }) {
  return (
    <Link
      to="/locations/$id"
      params={{ id: location.id }}
      className={cn(
        'block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        card ? '-mx-4 -my-3 px-4 py-3' : 'hover:underline',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Table columns and card of a location list. `nested` is the list of one location's sub-locations:
 * it needs neither the parent path (the page shows it) nor the type (only top-level locations have one).
 */
export function useLocationRows({ nested }: { nested: boolean }) {
  const { t } = useTranslation();

  const counts = (location: LocationDto) => [
    t('common.itemCount', { count: location.itemCount }),
    t('common.subLocationCount', { count: location.childCount }),
  ];
  const path = (location: LocationDto) => (nested ? '' : parentPath(location));

  const typeColumn: Column<LocationDto> = {
    header: t('home.locations.columns.type'),
    className: 'w-32',
    cell: (location) => location.type && <Badge>{location.type.name}</Badge>,
  };

  const columns: Column<LocationDto>[] = [
    {
      header: t('home.locations.columns.name'),
      primary: true,
      cell: (location) => {
        const above = path(location);
        return (
          <>
            <LocationLink location={location}>
              <span className="block truncate">{location.name}</span>
            </LocationLink>
            {above && <p className="truncate text-xs font-normal text-muted-foreground">{above}</p>}
          </>
        );
      },
    },
    ...(nested ? [] : [typeColumn]),
    { header: t('home.locations.columns.address'), cell: (location) => location.address },
    {
      header: t('home.locations.columns.items'),
      className: 'w-28',
      cell: (location) => counts(location)[0],
    },
    {
      header: t('home.locations.columns.subLocations'),
      className: 'w-36',
      cell: (location) => counts(location)[1],
    },
  ];

  const card = (location: LocationDto) => {
    const above = path(location);
    return (
      <LocationLink location={location} card>
        <p className="truncate text-[15px] font-semibold">{location.name}</p>
        {above && <p className="truncate text-xs text-muted-foreground">{above}</p>}
        <p className="mt-1 text-sm text-muted-foreground">
          {location.type && <Badge className="mr-2">{location.type.name}</Badge>}
          {[location.address, ...counts(location)].filter(Boolean).join(' · ')}
        </p>
      </LocationLink>
    );
  };

  return { columns, card };
}

/** Locations tab: top-level locations, or matches at every level while searching. */
export function LocationsPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(locationListQueryOptions(q));
  const total = pagedTotal(query.data);
  const { columns, card } = useLocationRows({ nested: false });

  return (
    <>
      <ListToolbar
        title={t('home.locations.tab')}
        count={total === undefined ? undefined : t('common.locationCount', { count: total })}
        search={{
          value: q,
          onSearch,
          label: t('home.locations.searchLabel'),
          placeholder: t('home.locations.searchPlaceholder'),
        }}
      />
      <PagedList
        query={query}
        searching={q !== ''}
        empty={{ title: t('home.locations.emptyTitle'), hint: t('home.locations.emptyHint') }}
        columns={columns}
        card={card}
      />
    </>
  );
}
