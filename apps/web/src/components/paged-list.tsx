import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';

type Page<T> = { items: T[]; nextCursor: string | null; total: number };

type Props<T extends { id: string }> = {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  /** Whether the list is filtered by a search text; decides between "empty" and "nothing found". */
  searching: boolean;
  /** What to say when there is nothing at all. */
  empty: { title: string; hint: string };
  /** Column headings, shown from the `md` breakpoint up (the mobile layout has none). */
  header: ReactNode;
  /** Grid columns of a row from the `md` breakpoint up; the header uses the same ones. */
  columns: string;
  row: (item: T) => ReactNode;
};

/** The count for a list heading, once the first page is there. */
export function pagedTotal<T>(data: InfiniteData<Page<T>> | undefined): number | undefined {
  return data?.pages.at(-1)?.total;
}

function ListSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="divide-y">
      {[0, 1, 2, 3, 4].map((n) => (
        <div key={n} className="flex flex-col gap-2 px-4 py-3">
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * The body of a searchable, paged list with every state the screens need: loading skeleton, error
 * with retry, empty, nothing found, and the rows with a "load more" button. While a new search is
 * loading the previous rows stay on screen (dimmed) instead of flashing a skeleton.
 */
export function PagedList<T extends { id: string }>({
  query,
  searching,
  empty,
  header,
  columns,
  row,
}: Props<T>) {
  const { t } = useTranslation();
  const { data } = query;

  if (!data) {
    if (query.isError) {
      return <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />;
    }
    return <ListSkeleton />;
  }

  const items = data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return searching ? (
      <EmptyState title={t('states.noResultsTitle')} hint={t('states.noResultsHint')} />
    ) : (
      <EmptyState title={empty.title} hint={empty.hint} />
    );
  }

  return (
    <div aria-busy={query.isPlaceholderData} className={query.isPlaceholderData ? 'opacity-60' : undefined}>
      <div
        aria-hidden
        className={`hidden gap-4 border-b px-4 py-2 text-xs font-bold tracking-wide text-muted-foreground uppercase md:grid ${columns}`}
      >
        {header}
      </div>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className={`px-4 py-3 md:grid md:items-center md:gap-4 ${columns}`}>
            {row(item)}
          </li>
        ))}
      </ul>
      {query.isError && (
        <div role="alert" className="flex flex-col items-center gap-2 px-4 py-4 text-center">
          <p className="text-sm text-muted-foreground">{problemMessage(query.error)}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void (query.hasNextPage ? query.fetchNextPage() : query.refetch())}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {query.hasNextPage && !query.isError && (
        <div className="flex justify-center px-4 py-4">
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Nothing to show is not an error, so this is not `ErrorState` (no alert role, no warning icon). */
function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
