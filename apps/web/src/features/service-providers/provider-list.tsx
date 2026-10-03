import type { ServiceProviderDto } from '@inventory/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/archived-badge';
import { ListFrame, ListToolbar } from '@/components/list-toolbar';
import { type Column, PagedList, pagedTotal } from '@/components/paged-list';
import { Button } from '@/components/ui/button';
import { useCanWrite } from '@/features/auth/use-can-write';
import { providerListQueryOptions } from './api';

/** Suppliers tab: the service providers by name, or the matches of a search; or the archived ones. */
export function ServiceProvidersPanel({
  q,
  onSearch,
  archived,
  onArchived,
}: {
  q: string;
  onSearch: (text: string) => void;
  /** Whether the archived providers are listed instead of the active ones. */
  archived: boolean;
  onArchived: (archived: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(providerListQueryOptions(q, archived));
  const total = pagedTotal(query.data);
  const canWrite = useCanWrite();

  const columns: Column<ServiceProviderDto>[] = [
    {
      header: t('home.suppliers.columns.name'),
      primary: true,
      cell: (provider) => (
        <>
          <Link to="/service-providers/$id" params={{ id: provider.id }} className="hover:underline">
            {provider.name}
          </Link>
          {provider.archivedAt && <ArchivedBadge className="mt-1 flex w-fit" />}
        </>
      ),
    },
    { header: t('home.suppliers.columns.code'), className: 'w-32', cell: (provider) => provider.code },
    { header: t('home.suppliers.columns.phone'), cell: (provider) => provider.phone ?? t('common.empty') },
  ];

  // The card is one link to the supplier; its phone is called from the detail.
  const card = (provider: ServiceProviderDto) => (
    <Link to="/service-providers/$id" params={{ id: provider.id }} className="block">
      <p className="text-[15px] font-semibold">
        {provider.name}
        {provider.archivedAt && <ArchivedBadge className="ml-2 align-middle" />}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {[provider.code, provider.phone].filter(Boolean).join(' · ')}
      </p>
    </Link>
  );

  return (
    <>
      <ListToolbar
        title={t('home.suppliers.tab')}
        count={total === undefined ? undefined : t('common.providerCount', { count: total })}
        archived={{ checked: archived, onChange: onArchived, label: t('home.showArchived') }}
        action={
          canWrite && (
            <Button asChild>
              <Link to="/service-providers/new">
                <Plus aria-hidden />
                {t('home.suppliers.add')}
              </Link>
            </Button>
          )
        }
        search={{
          value: q,
          onSearch,
          label: t('home.suppliers.searchLabel'),
          placeholder: t('home.suppliers.searchPlaceholder'),
        }}
      />
      <ListFrame>
        <PagedList
          query={query}
          searching={q !== ''}
          empty={
            archived
              ? { title: t('home.suppliers.archivedEmptyTitle'), hint: t('home.archivedEmptyHint') }
              : { title: t('home.suppliers.emptyTitle'), hint: t('home.suppliers.emptyHint') }
          }
          columns={columns}
          card={card}
        />
      </ListFrame>
    </>
  );
}
