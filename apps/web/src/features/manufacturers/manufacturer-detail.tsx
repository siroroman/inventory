import type { ManufacturerDetailDto } from '@inventory/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
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

/** The way back: where the user came from (an item, a supplier), or the suppliers list on a deep link. */
function BackButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const content = (
    <>
      <ArrowLeft aria-hidden />
      <span className="truncate">{canGoBack ? t('manufacturer.back') : t('home.suppliers.tab')}</span>
    </>
  );
  return (
    <Button
      asChild={!canGoBack}
      variant="link"
      className="-mb-3 min-h-11 max-w-full min-w-0 self-start px-0 text-foreground"
      onClick={canGoBack ? () => router.history.back() : undefined}
    >
      {canGoBack ? content : <Link to="/" search={{ tab: 'suppliers' }}>{content}</Link>}
    </Button>
  );
}

/** The ranked suppliers; writers move a card up or down and the new order is saved at once. */
function ProviderOrder({ manufacturer }: { manufacturer: ManufacturerDetailDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const detail = manufacturerQueryOptions(manufacturer.id);
  // Read out after a move: the card moves under the focus, so say where it went.
  const [announcement, setAnnouncement] = useState('');

  const reorder = useMutation({
    mutationFn: ({ providerIds }: { providerIds: string[]; moved: { name: string; position: number } }) =>
      setProviderOrder(manufacturer.id, providerIds),
    // The cards show the new order straight away; a failure (toasted by the query client) puts the old one back.
    onMutate: async ({ providerIds }) => {
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
    onSuccess: (_answer, { moved }) =>
      setAnnouncement(t('manufacturer.moved', { name: moved.name, position: moved.position, total: manufacturer.providers.length })),
    // Whatever shows the priority (the suppliers' brand lists) is stale now, and so is this list after a failure.
    onSettled: () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' }),
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
          onReorder={canReorder ? (providerIds, moved) => reorder.mutate({ providerIds, moved }) : undefined}
          busy={reorder.isPending}
        />
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

function ManufacturerBody({ manufacturer }: { manufacturer: ManufacturerDetailDto }) {
  const { t } = useTranslation();
  return (
    <>
      <BackButton />
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
    const missing =
      query.error instanceof ApiError && (query.error.code === 'not_found' || query.error.code === 'validation_error');
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
