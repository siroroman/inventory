import type { ItemListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { Badge } from '@/components/ui/badge';
import { serviceStatus } from '@/lib/service-status';
import { itemListQueryOptions } from './api';

const pathOf = (item: ItemListEntryDto) => item.path.map((segment) => segment.name).join(' › ');
const brandAndModel = (item: ItemListEntryDto) =>
  [item.manufacturer?.name, item.model].filter(Boolean).join(' ');

/** Items tab: every active item by name, or the matches of a search. */
export function ItemsPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(itemListQueryOptions(q));
  const total = pagedTotal(query.data);

  // "Service overdue" / "Service due within 30 days", or nothing.
  const serviceBadge = (item: ItemListEntryDto) => {
    const status = serviceStatus(item.nextServiceOn);
    if (!status) return null;
    return (
      <Badge variant={status === 'overdue' ? 'danger' : 'warning'}>
        {t(`home.items.service.${status}`)}
      </Badge>
    );
  };

  const columns: Column<ItemListEntryDto>[] = [
    { header: t('home.items.columns.name'), primary: true, cell: (item) => item.name },
    { header: t('home.items.columns.code'), className: 'w-28', cell: (item) => item.code },
    {
      header: t('home.items.columns.location'),
      cell: (item) => <span title={pathOf(item)}>{pathOf(item)}</span>,
    },
    { header: t('home.items.columns.brand'), cell: brandAndModel },
    { header: t('home.items.columns.service'), className: 'w-44', cell: serviceBadge },
  ];

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
        card={(item) => {
          const badge = serviceBadge(item);
          return (
            <>
              <p className="text-[15px] font-semibold">{item.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.code} · {pathOf(item)}
              </p>
              {brandAndModel(item) && (
                <p className="text-sm text-muted-foreground">{brandAndModel(item)}</p>
              )}
              {badge && <p className="mt-1.5">{badge}</p>}
            </>
          );
        }}
      />
    </>
  );
}
