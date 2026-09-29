import type { LocationDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { Badge } from '@/components/ui/badge';
import { locationListQueryOptions } from './api';

/** A search also finds sub-locations; their name alone would not say where they are. */
function parentPath(location: LocationDto): string {
  return location.path
    .slice(0, -1)
    .map((segment) => segment.name)
    .join(' › ');
}

/** Locations tab: top-level locations, or matches at every level while searching. */
export function LocationsPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(locationListQueryOptions(q));
  const total = pagedTotal(query.data);

  const counts = (location: LocationDto) => [
    t('common.itemCount', { count: location.itemCount }),
    t('common.subLocationCount', { count: location.childCount }),
  ];

  const columns: Column<LocationDto>[] = [
    {
      header: t('home.locations.columns.name'),
      primary: true,
      cell: (location) => (
        <>
          <p className="truncate">{location.name}</p>
          {parentPath(location) && (
            <p className="truncate text-xs font-normal text-muted-foreground">{parentPath(location)}</p>
          )}
        </>
      ),
    },
    {
      header: t('home.locations.columns.type'),
      className: 'w-32',
      cell: (location) => location.type && <Badge>{location.type.name}</Badge>,
    },
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
        card={(location) => (
          <>
            <p className="truncate text-[15px] font-semibold">{location.name}</p>
            {parentPath(location) && (
              <p className="truncate text-xs text-muted-foreground">{parentPath(location)}</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {location.type && <Badge className="mr-2">{location.type.name}</Badge>}
              {[location.address, ...counts(location)].filter(Boolean).join(' · ')}
            </p>
          </>
        )}
      />
    </>
  );
}
