import type { ItemListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { serviceStatus } from '@/lib/service-status';
import { itemListQueryOptions } from './api';
import { ServiceBadge } from './service-badge';

const pathOf = (item: ItemListEntryDto) => item.path.map((segment) => segment.name).join(' › ');
const brandAndModel = (item: ItemListEntryDto) =>
  [item.manufacturer?.name, item.model].filter(Boolean).join(' ');

/** Table columns and card of an item list. */
export function useItemRows() {
  const { t } = useTranslation();

  // "Service overdue" / "Service due within 30 days", or nothing.
  const serviceBadge = (item: ItemListEntryDto) => (
    <ServiceBadge
      nextServiceOn={item.nextServiceOn}
      labels={{ overdue: t('home.items.service.overdue'), soon: t('home.items.service.soon') }}
    />
  );

  const columns: Column<ItemListEntryDto>[] = [
    {
      header: t('home.items.columns.name'),
      primary: true,
      cell: (item) => (
        <Link to="/items/$id" params={{ id: item.id }} className="hover:underline">
          {item.name}
        </Link>
      ),
    },
    { header: t('home.items.columns.code'), className: 'w-28', cell: (item) => item.code },
    {
      header: t('home.items.columns.location'),
      cell: (item) => <span title={pathOf(item)}>{pathOf(item)}</span>,
    },
    { header: t('home.items.columns.brand'), cell: brandAndModel },
    { header: t('home.items.columns.service'), className: 'w-44', cell: serviceBadge },
  ];

  const card = (item: ItemListEntryDto) => {
    const badge = item.nextServiceOn && serviceStatus(item.nextServiceOn);
    return (
      <Link to="/items/$id" params={{ id: item.id }} className="block">
        <p className="text-[15px] font-semibold">{item.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.code} · {pathOf(item)}
        </p>
        {brandAndModel(item) && <p className="text-sm text-muted-foreground">{brandAndModel(item)}</p>}
        {badge && <p className="mt-1.5">{serviceBadge(item)}</p>}
      </Link>
    );
  };

  return { columns, card };
}

/** Items tab: every active item by name, or the matches of a search. */
export function ItemsPanel({ q, onSearch }: { q: string; onSearch: (text: string) => void }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(itemListQueryOptions(q));
  const total = pagedTotal(query.data);
  const { columns, card } = useItemRows();

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
        card={card}
      />
    </>
  );
}
