import type { ManufacturerDetailDto } from '@inventory/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { BackButton } from '@/components/back-button';
import { ErrorState } from '@/components/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { invalidateAfterWrite } from '@/lib/query';
import { manufacturerQueryOptions, setProviderOrder } from './api';
import { RankedProviders } from './ranked-providers';

function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-6 w-56 max-w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** The ranked suppliers; writers drag a card to another place and the new order is saved at once. */
function ProviderOrder({ manufacturer }: { manufacturer: ManufacturerDetailDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const detail = manufacturerQueryOptions(manufacturer.id);

  const reorder = useMutation({
    mutationFn: (providerIds: string[]) => setProviderOrder(manufacturer.id, providerIds),
    // The cards show the new order straight away; a failure (toasted by the query client) puts the old one back.
    onMutate: async (providerIds) => {
      await queryClient.cancelQueries({ queryKey: detail.queryKey });
      const previous = queryClient.getQueryData(detail.queryKey);
      queryClient.setQueryData(detail.queryKey, (current) =>
        current && {
          ...current,
          providers: providerIds.map((id, index) => ({ ...current.providers.find((p) => p.id === id)!, priority: index + 1 })),
        },
      );
      return { previous };
    },
    onError: (_error, _ids, context) => queryClient.setQueryData(detail.queryKey, context?.previous),
    // Whatever shows the priority (the suppliers' brand lists) is stale now, and so is this list after a failure.
    onSettled: () => invalidateAfterWrite(queryClient),
  });

  // An archived brand's order is read-only; the API refuses it too.
  const canReorder = canWrite && !manufacturer.archivedAt;

  return (
    <section aria-labelledby="manufacturer-providers" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="manufacturer-providers" className="text-lg font-semibold">
          {t('manufacturer.providers.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('manufacturer.providers.hint')}</p>
      </div>
      {manufacturer.providers.length === 0 ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[15px]">{t('manufacturer.providers.empty')}</p>
          {canWrite && <p className="mt-1 text-sm text-muted-foreground">{t('manufacturer.providers.emptyHint')}</p>}
        </div>
      ) : (
        <RankedProviders
          providers={manufacturer.providers}
          onReorder={canReorder ? (providerIds) => reorder.mutate(providerIds) : undefined}
          busy={reorder.isPending}
        />
      )}
    </section>
  );
}

function ManufacturerBody({ manufacturer }: { manufacturer: ManufacturerDetailDto }) {
  const { t } = useTranslation();
  return (
    <>
      <BackButton fallback={(content) => <Link to="/" search={{ tab: 'suppliers' }}>{content}</Link>} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold break-words">{manufacturer.name}</h1>
        {manufacturer.archivedAt && <ArchivedBadge />}
      </div>
      {manufacturer.note && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">{t('manufacturer.note')}</h2>
          <p className="text-[15px] break-words whitespace-pre-line">{manufacturer.note}</p>
        </section>
      )}
      <ProviderOrder manufacturer={manufacturer} />
    </>
  );
}

/** Brand screen: the service providers to contact, in order. */
export function ManufacturerDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(manufacturerQueryOptions(id));

  let body: ReactNode;
  if (query.data) {
    body = <ManufacturerBody manufacturer={query.data} />;
  } else if (query.isError) {
    // A missing brand (or an id that is no id at all) will not appear on a retry.
    const missing = isMissingRecord(query.error);
    body = missing ? (
      <ErrorState title={t('manufacturer.notFoundTitle')} message={t('manufacturer.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else {
    body = <DetailSkeleton />;
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">{body}</div>;
}
