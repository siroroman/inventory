import type { ItemListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ListToolbar } from '@/components/list-toolbar';
import { PagedList, pagedTotal } from '@/components/paged-list';
import { Badge } from '@/components/ui/badge';
import { serviceStatus } from '@/lib/service-status';
import { Dot } from '@/components/dot';
import { cn } from '@/lib/utils';
import { itemListQueryOptions } from './api';

// One grid for the header and every row (from `md` up; below that a row is a small card).
const columns = 'md:grid-cols-[minmax(0,2fr)_7rem_minmax(0,2fr)_minmax(0,2fr)_10rem]';

function ItemRow({ item }: { item: ItemListEntryDto }) {
  const { t } = useTranslation();
  const path = item.path.map((segment) => segment.name).join(' › ');
  const brandAndModel = [item.manufacturer?.name, item.model].filter(Boolean).join(' ');
  const status = serviceStatus(item.nextServiceOn);
  return (
    <>
      <p className="min-w-0 truncate text-[15px] font-semibold">{item.name}</p>
      <div className="mt-1 text-sm text-muted-foreground md:contents">
        {/* On mobile the ID and the path run together as one wrapping line; from md up they are columns. */}
        <p className="md:contents">
          <span>{item.code}</span>
          <Dot />
          <span title={path} className="min-w-0 md:truncate">
            {path}
          </span>
        </p>
        <p className={cn('md:truncate', !brandAndModel && 'hidden md:block')}>{brandAndModel}</p>
        <p className={cn('mt-1.5 md:mt-0', !status && 'hidden md:block')}>
          {status && (
            <Badge variant={status === 'overdue' ? 'danger' : 'warning'}>
              {t(`home.items.service.${status}`)}
            </Badge>
          )}
        </p>
      </div>
    </>
  );
}

/** Items tab: every active item by name, or the matches of a search. */
export function ItemsPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(itemListQueryOptions(q));
  const total = pagedTotal(query.data);
  return (
    <>
      <ListToolbar
        title={t('home.items.tab')}
        count={total === undefined ? undefined : t('common.itemCount', { count: total })}
        search={{
          value: q,
          onSearch,
          label: t('home.items.searchLabel'),
          placeholder: t('home.items.searchPlaceholder'),
        }}
      />
      <PagedList
        query={query}
        searching={q !== ''}
        empty={{ title: t('home.items.emptyTitle'), hint: t('home.items.emptyHint') }}
        columns={columns}
        header={
          <>
            <span>{t('home.items.columns.name')}</span>
            <span>{t('home.items.columns.code')}</span>
            <span>{t('home.items.columns.location')}</span>
            <span>{t('home.items.columns.brand')}</span>
            <span>{t('home.items.columns.service')}</span>
          </>
        }
        row={(item) => <ItemRow item={item} />}
      />
    </>
  );
}
