import type { LocationDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { ListToolbar } from '@/components/list-toolbar';
import { type Column, nestedNameColumnWidth, PagedList, pagedTotal } from '@/components/paged-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/features/auth/use-can-write';
import { cn } from '@/lib/utils';
import { locationListQueryOptions } from './api';
import { pathLabel } from './path';

/** A search also finds sub-locations; their name alone would not say where they are. */
function parentPath(location: LocationDto): string {
  return pathLabel(location.path.slice(0, -1));
}

/** The name of a location as a link to its detail; on a card the link covers the whole row. */
function LocationLink({ location, card, children }: { location: LocationDto; card?: boolean; children: ReactNode }) {
  return (
    <Link
      to="/locations/$id"
      params={{ id: location.id }}
      className={cn(
        'block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        card ? '-mx-4 -my-3 px-4 py-3 focus-visible:ring-inset' : 'hover:underline',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Table columns and card of a location list. `nested` is the list of one location's sub-locations:
 * it needs neither the parent path (the page shows it), nor the type (only top-level locations have one),
 * nor the address column. Its counts keep the items first, so the item count lines up with the ID of the items table.
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

  const addressColumn: Column<LocationDto> = {
    header: t('home.locations.columns.address'),
    cell: (location) => location.address,
  };

  const itemsColumn: Column<LocationDto> = {
    header: t('home.locations.columns.items'),
    className: 'w-28',
    cell: (location) => counts(location)[0],
  };

  const subLocationsColumn: Column<LocationDto> = {
    header: t('home.locations.columns.subLocations'),
    className: 'w-36',
    cell: (location) => counts(location)[1],
  };

  const columns: Column<LocationDto>[] = [
    {
      header: t('home.locations.columns.name'),
      primary: true,
      className: nested ? nestedNameColumnWidth : undefined,
      cell: (location) => {
        const above = path(location);
        return (
          <>
            <LocationLink location={location}>
              <span className="block truncate">{location.name}</span>
            </LocationLink>
            {location.archivedAt && <ArchivedBadge className="mt-1 flex w-fit" />}
            {above && <p className="truncate text-xs font-normal text-muted-foreground">{above}</p>}
          </>
        );
      },
    },
    ...(nested ? [itemsColumn, subLocationsColumn] : [typeColumn, addressColumn, subLocationsColumn, itemsColumn]),
  ];

  const card = (location: LocationDto) => {
    const above = path(location);
    return (
      <LocationLink location={location} card>
        <p className="truncate text-[15px] font-semibold">
          {location.name}
          {location.archivedAt && <ArchivedBadge className="ml-2 align-middle" />}
        </p>
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

type PanelProps = {
  q: string;
  onSearch: (text: string) => void;
  /** Whether the archived records are listed instead of the active ones. */
  archived: boolean;
  onArchived: (archived: boolean) => void;
};

/** Locations tab: top-level locations, or matches at every level while searching; or the archived ones. */
export function LocationsPanel({ q, onSearch, archived, onArchived }: PanelProps) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(locationListQueryOptions(q, archived));
  const canWrite = useCanWrite();
  const total = pagedTotal(query.data);
  const { columns, card } = useLocationRows({ nested: false });

  return (
    <>
      <ListToolbar
        title={t('home.locations.tab')}
        action={
          canWrite && (
            <Button asChild>
              <Link to="/locations/new">
                <Plus aria-hidden />
                {t('home.locations.add')}
              </Link>
            </Button>
          )
        }
        count={total === undefined ? undefined : t('common.locationCount', { count: total })}
        archived={{ checked: archived, onChange: onArchived, label: t('home.showArchived') }}
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
        empty={
          archived
            ? { title: t('home.locations.archivedEmptyTitle'), hint: t('home.archivedEmptyHint') }
            : { title: t('home.locations.emptyTitle'), hint: t('home.locations.emptyHint') }
        }
        columns={columns}
        card={card}
      />
    </>
  );
}
