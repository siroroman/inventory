import type { ServiceRecordListEntryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { ListFrame, ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/features/auth/use-can-write';
import { pathLabel } from '@/features/locations/path';
import { formatDate } from '@/lib/format';
import { serviceRecordListQueryOptions } from './api';

/** Maintenance tab: the service records of all items, newest first, or the matches of a search; or the archived ones. */
export function ServiceRecordsPanel({
  q,
  onSearch,
  archived,
  onArchived,
}: {
  q: string;
  onSearch: (text: string) => void;
  /** Whether the archived records are listed instead of the active ones. */
  archived: boolean;
  onArchived: (archived: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(serviceRecordListQueryOptions(q, archived));
  const total = pagedTotal(query.data);
  const canWrite = useCanWrite();

  const columns: Column<ServiceRecordListEntryDto>[] = [
    {
      header: t('home.maintenance.columns.title'),
      primary: true,
      cell: (record) => (
        <>
          <Link to="/service-records/$id" params={{ id: record.id }} className="hover:underline">
            {record.title}
          </Link>
          {record.archivedAt && <ArchivedBadge className="mt-1 flex w-fit" />}
        </>
      ),
    },
    { header: t('home.maintenance.columns.code'), className: 'w-32', cell: (record) => record.item.code },
    {
      header: t('home.maintenance.columns.date'),
      className: 'w-32',
      cell: (record) => formatDate(record.performedOn),
    },
    {
      header: t('home.maintenance.columns.item'),
      cell: (record) => (
        <Link to="/items/$id" params={{ id: record.item.id }} className="underline underline-offset-2">
          {record.item.name}
        </Link>
      ),
    },
    {
      header: t('home.maintenance.columns.location'),
      cell: (record) => (
        <span title={pathLabel(record.path)}>{pathLabel(record.path) || t('common.empty')}</span>
      ),
    },
  ];

  // The card is one link to the record; the item is named, its own link is on the record's page.
  const card = (record: ServiceRecordListEntryDto) => (
    <Link to="/service-records/$id" params={{ id: record.id }} className="block">
      <p className="text-[15px] font-semibold">
        {record.title}
        {record.archivedAt && <ArchivedBadge className="ml-2 align-middle" />}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDate(record.performedOn)} · {record.item.name} · {record.item.code}
      </p>
      {record.path.length > 0 && (
        <p className="truncate text-sm text-muted-foreground">{pathLabel(record.path)}</p>
      )}
    </Link>
  );

  return (
    <>
      <ListToolbar
        title={t('home.maintenance.tab')}
        count={total === undefined ? undefined : t('common.recordCount', { count: total })}
        archived={{ checked: archived, onChange: onArchived, label: t('home.showArchived') }}
        action={
          canWrite && (
            <Button asChild>
              <Link to="/service-records/new">
                <Plus aria-hidden />
                {t('home.maintenance.add')}
              </Link>
            </Button>
          )
        }
        search={{
          value: q,
          onSearch,
          label: t('home.maintenance.searchLabel'),
          placeholder: t('home.maintenance.searchPlaceholder'),
        }}
      />
      <ListFrame>
        <PagedList
          query={query}
          searching={q !== ''}
          empty={
            archived
              ? { title: t('home.maintenance.archivedEmptyTitle'), hint: t('home.archivedEmptyHint') }
              : { title: t('home.maintenance.emptyTitle'), hint: t('home.maintenance.emptyHint') }
          }
          columns={columns}
          card={card}
        />
      </ListFrame>
    </>
  );
}
