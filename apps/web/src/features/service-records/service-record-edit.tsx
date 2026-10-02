import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { useCanWrite } from '@/features/auth/use-can-write';
import { itemDetailQueryOptions } from '@/features/items/api';
import { FormSkeleton, NoWriteAccess } from '@/features/items/item-edit';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { serviceRecordQueryOptions } from './api';
import { ServiceRecordForm } from './service-record-form';

const isMissing = (error: unknown) =>
  error instanceof ApiError && (error.code === 'not_found' || error.code === 'validation_error');

/** New service record screen: loads the item the record is added to, then the empty form. */
export function ServiceRecordCreate({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery({ ...itemDetailQueryOptions(itemId), enabled: canWrite });

  // The route guard has loaded the session, so the role is known by now.
  if (!canWrite) return <NoWriteAccess />;
  if (query.data?.archivedAt) return <ErrorState title={t('errors.archived')} />;
  if (query.data) return <ServiceRecordForm item={{ id: query.data.id, name: query.data.name }} />;
  if (query.isError) {
    return isMissing(query.error) ? (
      <ErrorState title={t('item.notFoundTitle')} message={t('item.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  }
  return <FormSkeleton />;
}

/** Edit service record screen: loads the record (fresh, so the version is current), then the form. */
export function ServiceRecordEdit({ id }: { id: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery({
    ...serviceRecordQueryOptions(id),
    staleTime: 0,
    // A background refetch that brings a newer version would remount the form and drop what was typed.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!canWrite) return <NoWriteAccess />;
  // The detail offers no Edit for these; a typed-in URL gets the same answer up front.
  if (query.data && (query.data.archivedAt || query.data.item.archivedAt)) {
    return <ErrorState title={t('errors.archived')} />;
  }
  if (query.data) {
    // A new version (after "load current data") remounts the form with the fresh values.
    return (
      <ServiceRecordForm
        key={query.data.version}
        item={query.data.item}
        record={query.data}
        onReload={() => void query.refetch()}
      />
    );
  }
  if (query.isError) {
    return isMissing(query.error) ? (
      <ErrorState title={t('serviceRecord.notFoundTitle')} message={t('serviceRecord.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  }
  return <FormSkeleton />;
}
