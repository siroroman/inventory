import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { useCanWrite } from '@/features/auth/use-can-write';
import { itemDetailQueryOptions } from '@/features/items/api';
import { FormSkeleton, NoWriteAccess } from '@/features/items/item-edit';
import { isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { serviceRecordQueryOptions } from './api';
import { ServiceRecordForm } from './service-record-form';

/** New record from the Maintenance tab: the form asks for the item itself. */
export function NewServiceRecord() {
  // The route guard has loaded the session, so the role is known by now.
  return useCanWrite() ? <ServiceRecordForm /> : <NoWriteAccess />;
}

/** New service record screen of an item: loads the item the record is added to, then the empty form. */
export function ServiceRecordCreate({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const query = useQuery({ ...itemDetailQueryOptions(itemId), enabled: canWrite });

  if (!canWrite) return <NoWriteAccess />;
  if (query.data?.archivedAt) return <ErrorState title={t('errors.archived')} />;
  if (query.data) return <ServiceRecordForm item={{ id: query.data.id, code: query.data.code, name: query.data.name }} />;
  if (query.isError) {
    return isMissingRecord(query.error) ? (
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
    return isMissingRecord(query.error) ? (
      <ErrorState title={t('serviceRecord.notFoundTitle')} message={t('serviceRecord.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  }
  return <FormSkeleton />;
}
