import type { ServiceProviderDetailDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveControl } from '@/components/archive-control';
import { ArchivedBadge } from '@/components/archived-badge';
import { DetailFields } from '@/components/detail-fields';
import { ErrorState } from '@/components/error-state';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { isMissingRecord } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { archiveProvider, providerQueryOptions, restoreProvider } from './api';

const linkClass = 'underline underline-offset-2';

function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-6 w-56 max-w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** The brands the provider services, each with its place in that brand's contact order. */
function Brands({ provider }: { provider: ServiceProviderDetailDto }) {
  const { t } = useTranslation();
  return (
    <Section title={t('provider.brands.title')}>
      {provider.manufacturers.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{t('provider.brands.empty')}</p>
      ) : (
        <ul className="-my-2 flex flex-col divide-y">
          {provider.manufacturers.map((brand) => (
            <li key={brand.id} className="flex min-h-11 items-center gap-3 py-2">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
              >
                {brand.priority}
              </span>
              <Link
                to="/manufacturers/$id"
                params={{ id: brand.id }}
                className="min-w-0 flex-1 text-[15px] font-semibold break-words hover:underline"
              >
                {brand.name}
              </Link>
              {brand.archivedAt && <ArchivedBadge />}
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('provider.brands.priority', { priority: brand.priority })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ProviderBody({ provider }: { provider: ServiceProviderDetailDto }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();

  return (
    <>
      <Button asChild variant="link" className="-mb-3 min-h-11 max-w-full min-w-0 self-start px-0 text-foreground">
        <Link to="/" search={{ tab: 'suppliers' }}>
          <ArrowLeft aria-hidden />
          <span className="truncate">{t('home.suppliers.tab')}</span>
        </Link>
      </Button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold break-words">{provider.name}</h1>
        {provider.archivedAt && <ArchivedBadge />}
        {canWrite && (
          <div className="ml-auto flex items-center gap-2">
            {!provider.archivedAt && (
              <Button asChild size="sm">
                <Link to="/service-providers/$id/edit" params={{ id: provider.id }}>
                  <Pencil aria-hidden />
                  {t('provider.edit')}
                </Link>
              </Button>
            )}
            <ArchiveControl
              archived={provider.archivedAt !== null}
              archive={() => archiveProvider(provider.id, provider.version)}
              restore={() => restoreProvider(provider.id, provider.version)}
              title={t('provider.archiveTitle')}
              description={<p>{t('provider.archiveHint')}</p>}
            />
          </div>
        )}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <DetailFields
          rows={[
            { label: t('provider.fields.code'), value: provider.code },
            { label: t('provider.fields.contactPerson'), value: provider.contactPerson },
            {
              label: t('provider.fields.phone'),
              value: provider.phone && (
                <a href={`tel:${provider.phone.replace(/\s+/g, '')}`} className={linkClass}>
                  {provider.phone}
                </a>
              ),
            },
            {
              label: t('provider.fields.email'),
              value: provider.email && (
                <a href={`mailto:${provider.email}`} className={`${linkClass} break-all`}>
                  {provider.email}
                </a>
              ),
            },
            {
              label: t('provider.fields.web'),
              value: provider.web && (
                <a href={provider.web} target="_blank" rel="noopener noreferrer" className={`${linkClass} break-all`}>
                  {provider.web}
                </a>
              ),
            },
          ]}
        />
        {provider.note && (
          <div className="mt-4">
            <h2 className="mb-1 text-sm font-semibold text-foreground">{t('provider.fields.note')}</h2>
            <p className="text-[15px] break-words whitespace-pre-line">{provider.note}</p>
          </div>
        )}
      </section>

      <Brands provider={provider} />
    </>
  );
}

/** Supplier screen: contact data and the brands the supplier services. */
export function ServiceProviderDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(providerQueryOptions(id));

  let body: ReactNode;
  if (query.data) {
    body = <ProviderBody provider={query.data} />;
  } else if (query.isError) {
    // A missing supplier (or an id that is no id at all) will not appear on a retry.
    const missing = isMissingRecord(query.error);
    body = missing ? (
      <ErrorState title={t('provider.notFoundTitle')} message={t('provider.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else {
    body = <DetailSkeleton />;
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">{body}</div>;
}
