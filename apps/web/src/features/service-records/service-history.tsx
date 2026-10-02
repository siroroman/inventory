import type { ServiceRecordSummaryDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { formatDate } from '@/lib/format';
import { itemServiceRecordsQueryOptions } from './api';

/** The service history of an item: newest first, each row opens the record. */
export function ServiceHistory({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(itemServiceRecordsQueryOptions(itemId));
  const total = pagedTotal(query.data);

  const columns: Column<ServiceRecordSummaryDto>[] = [
    {
      header: t('serviceRecord.columns.title'),
      primary: true,
      cell: (record) => (
        <Link to="/service-records/$id" params={{ id: record.id }} className="hover:underline">
          {record.title}
        </Link>
      ),
    },
    {
      header: t('serviceRecord.columns.date'),
      className: 'w-36 text-right',
      cell: (record) => formatDate(record.performedOn),
    },
  ];

  const card = (record: ServiceRecordSummaryDto) => (
    <Link to="/service-records/$id" params={{ id: record.id }} className="block">
      <p className="text-[15px] font-semibold">{record.title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{formatDate(record.performedOn)}</p>
    </Link>
  );

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3 pb-3">
        <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {total === undefined ? t('serviceRecord.history') : t('serviceRecord.historyCount', { count: total })}
        </h3>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <PagedList
          query={query}
          searching={false}
          empty={{ title: t('serviceRecord.emptyTitle'), hint: t('serviceRecord.emptyHint') }}
          columns={columns}
          card={card}
        />
      </div>
    </div>
  );
}
