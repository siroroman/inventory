import type { LocationDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Dot } from '@/components/dot';
import { ListToolbar } from '@/components/list-toolbar';
import { PagedList, pagedTotal } from '@/components/paged-list';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { locationListQueryOptions } from './api';

// One grid for the header and every row (from `md` up; below that a row is a small card).
const columns = 'md:grid-cols-[minmax(0,2fr)_7rem_minmax(0,2fr)_6rem_8rem]';

/** A piece of a card's grey line; on mobile pieces are joined by a dot, in the table by columns. A count stays with its unit. */
function Piece({ dotted, children }: { dotted?: boolean; children: string }) {
  return (
    <>
      {dotted && <Dot />}
      <span>{children.replace(' ', '\u00a0')}</span>
    </>
  );
}

function LocationRow({ location }: { location: LocationDto }) {
  const { t } = useTranslation();
  // A search also finds sub-locations; their name alone would not say where they are.
  const parents = location.path.slice(0, -1).map((segment) => segment.name);
  return (
    <>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold">{location.name}</p>
        {parents.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{parents.join(' › ')}</p>
        )}
      </div>
      <div className="mt-1 text-sm text-muted-foreground md:contents">
        <span className={cn('mr-2 md:mr-0', !location.type && 'hidden md:block')}>
          {location.type && <Badge>{location.type.name}</Badge>}
        </span>
        <span className={cn('min-w-0 md:truncate', !location.address && 'hidden md:block')}>
          {location.address}
        </span>
        <Piece dotted={Boolean(location.address)}>
          {t('common.itemCount', { count: location.itemCount })}
        </Piece>
        <Piece dotted>{t('common.subLocationCount', { count: location.childCount })}</Piece>
      </div>
    </>
  );
}

/** Locations tab: top-level locations, or matches at every level while searching. */
export function LocationsPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(locationListQueryOptions(q));
  const total = pagedTotal(query.data);
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
        header={
          <>
            <span>{t('home.locations.columns.name')}</span>
            <span>{t('home.locations.columns.type')}</span>
            <span>{t('home.locations.columns.address')}</span>
            <span>{t('home.locations.columns.items')}</span>
            <span>{t('home.locations.columns.subLocations')}</span>
          </>
        }
        row={(location) => <LocationRow location={location} />}
      />
    </>
  );
}
