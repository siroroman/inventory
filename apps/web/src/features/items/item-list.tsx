import type { ItemListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { ArchivedBadge } from '@/components/archived-badge';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/features/auth/use-can-write';
import { serviceStatus } from '@/lib/service-status';
import { itemListQueryOptions } from './api';
import { ServiceBadge } from './service-badge';

const pathOf = (item: ItemListEntryDto) => item.path.map((segment) => segment.name).join(' › ');
const brandAndModel = (item: ItemListEntryDto) =>
  [item.manufacturer?.name, item.model].filter(Boolean).join(' ');

/**
 * Table columns and card of an item list. `nested` is the list on a location's page: its name column
 * has the width of the sub-locations table above it, so the ID lines up with that table's item count.
 */
export function useItemRows({ nested }: { nested: boolean }) {
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
      className: nested ? 'w-80' : undefined,
      cell: (item) => (
        <>
          <Link to="/items/$id" params={{ id: item.id }} className="hover:underline">
            {item.name}
          </Link>
          {item.archivedAt && <ArchivedBadge className="mt-1 flex w-fit" />}
        </>
      ),
    },
    { header: t('home.items.columns.code'), className: 'w-28', cell: (item) => item.code },
    { header: t('home.items.columns.brand'), cell: brandAndModel },
    {
      header: t('home.items.columns.location'),
      cell: (item) => <span title={pathOf(item)}>{pathOf(item) || t('common.empty')}</span>,
    },
  ];

  const card = (item: ItemListEntryDto) => {
    const badge = item.nextServiceOn && serviceStatus(item.nextServiceOn);
    return (
      <Link to="/items/$id" params={{ id: item.id }} className="block">
        <p className="text-[15px] font-semibold">
          {item.name}
          {item.archivedAt && <ArchivedBadge className="ml-2 align-middle" />}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {[item.code, pathOf(item)].filter(Boolean).join(' · ')}
        </p>
        {brandAndModel(item) && <p className="text-sm text-muted-foreground">{brandAndModel(item)}</p>}
        {badge && <p className="mt-1.5">{serviceBadge(item)}</p>}
      </Link>
    );
  };

  return { columns, card };
}

/** Items tab: every active item by name, or the matches of a search; or the archived ones. */
export function ItemsPanel({
  q,
  onSearch,
  archived,
  onArchived,
}: {
  q: string;
  onSearch: (text: string) => void;
  /** Whether the archived items are listed instead of the active ones. */
  archived: boolean;
  onArchived: (archived: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(itemListQueryOptions(q, archived));
  const total = pagedTotal(query.data);
  const { columns, card } = useItemRows({ nested: false });
  const canWrite = useCanWrite();

  return (
    <>
      <ListToolbar
        title={t('home.items.tab')}
        count={total === undefined ? undefined : t('common.itemCount', { count: total })}
        archived={{ checked: archived, onChange: onArchived, label: t('home.showArchived') }}
        action={
          canWrite && (
            <Button asChild>
              <Link to="/items/new">
                <Plus aria-hidden />
                {t('home.items.add')}
              </Link>
            </Button>
          )
        }
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
        empty={
          archived
            ? { title: t('home.items.archivedEmptyTitle'), hint: t('home.archivedEmptyHint') }
            : { title: t('home.items.emptyTitle'), hint: t('home.items.emptyHint') }
        }
        columns={columns}
        card={card}
      />
    </>
  );
}
