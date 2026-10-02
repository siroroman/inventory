import type { ServiceRecordDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveControl } from '@/components/archive-control';
import { ArchivedBadge } from '@/components/archived-badge';
import { DetailFields } from '@/components/detail-fields';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { problemMessage } from '@/lib/problem';
import { archiveServiceRecord, restoreServiceRecord, serviceRecordQueryOptions } from './api';
import { ServiceRecordDocuments } from './documents';

function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-6 w-56 max-w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function RecordBody({ record }: { record: ServiceRecordDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  // Nothing about a record changes under an archived item. An archived record of an active item can
  // be restored, but not edited until then.
  const changeable = canWrite && !record.item.archivedAt;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold">{t('serviceRecord.title')}</h1>
        {record.archivedAt && <ArchivedBadge />}
        {changeable && (
          <div className="ml-auto flex items-center gap-2">
            {!record.archivedAt && (
              <Button asChild size="sm">
                <Link to="/service-records/$id/edit" params={{ id: record.id }}>
                  <Pencil aria-hidden />
                  {t('serviceRecord.edit')}
                </Link>
              </Button>
            )}
            <ArchiveControl
              archived={record.archivedAt !== null}
              archive={async () => {
                await archiveServiceRecord(record.id, record.version);
                // The record has left the item's history, so go back to it.
                await navigate({ to: '/items/$id', params: { id: record.item.id }, replace: true });
              }}
              restore={() => restoreServiceRecord(record.id, record.version)}
              title={t('serviceRecord.archiveTitle')}
              description={<p>{t('serviceRecord.archiveHint')}</p>}
            />
          </div>
        )}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <DetailFields
          rows={[
            {
              label: t('serviceRecord.fields.item'),
              value: (
                <Link to="/items/$id" params={{ id: record.item.id }} className="underline underline-offset-2">
                  {record.item.name}
                </Link>
              ),
            },
            { label: t('serviceRecord.fields.date'), value: formatDate(record.performedOn) },
            { label: t('serviceRecord.fields.title'), value: record.title },
            { label: t('serviceRecord.fields.performedBy'), value: record.performedBy },
            { label: t('serviceRecord.fields.responsiblePerson'), value: record.responsiblePerson },
          ]}
        />
        {record.description && (
          <div className="mt-4">
            <h2 className="mb-1 text-sm font-semibold text-foreground">
              {t('serviceRecord.fields.description')}
            </h2>
            <p className="text-[15px] break-words whitespace-pre-line">{record.description}</p>
          </div>
        )}
      </section>

      {/* Documents can be added and changed while the record and its item are active, as the API requires. */}
      <ServiceRecordDocuments recordId={record.id} canEdit={changeable && !record.archivedAt} />

      <div className="flex justify-end">
        {/* The button shows the item's name; the accessible name also says where it leads. */}
        <Button asChild size="sm" className="max-w-full min-w-0">
          <Link
            to="/items/$id"
            params={{ id: record.item.id }}
            aria-label={t('serviceRecord.backToItem', { name: record.item.name })}
          >
            <ArrowLeft aria-hidden />
            <span className="truncate">{record.item.name}</span>
          </Link>
        </Button>
      </div>
    </>
  );
}

/** Service record screen: what was done, when and by whom. */
export function ServiceRecordDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(serviceRecordQueryOptions(id));

  let body: ReactNode;
  if (query.data) {
    body = <RecordBody record={query.data} />;
  } else if (query.isError) {
    // A missing record (or an id that is no id at all) will not appear on a retry.
    const missing =
      query.error instanceof ApiError && (query.error.code === 'not_found' || query.error.code === 'validation_error');
    body = missing ? (
      <ErrorState title={t('serviceRecord.notFoundTitle')} message={t('serviceRecord.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else {
    body = <DetailSkeleton />;
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">{body}</div>;
}
