import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/** One column of the desktop table. */
export type Column<T> = {
  header: string;
  /** Width and the like; applied to the heading and to every cell of the column. */
  className?: string;
  /** The first column: the record's name, in stronger type. */
  primary?: boolean;
  cell: (item: T) => ReactNode;
};

type Props<T extends { id: string }> = {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  /** Whether the list is filtered by a search text; decides between "empty" and "nothing found". */
  searching: boolean;
  /** What to say when there is nothing at all. */
  empty: { title: string; hint: string };
  /** A table with these columns from 768 px up (Tailwind's `md`); without columns, cards at every width... */
  columns?: Column<T>[];
  /** ...and a list of these cards below it. */
  card: (item: T) => ReactNode;
  /**
   * An empty column after the last one, as wide as this many columns without a set width (those share
   * the spare room evenly). It lines the columns up with a table below that has more of them, and the
   * row lines still reach the edge.
   */
  fill?: number;
};

/**
 * Width of the name column in the tables on a location's page; shared so the sub-locations table
 * and the items table line up (the ID columns one under the other).
 */
export const nestedNameColumnWidth = 'w-80';

/**
 * Width of the ID column in the location and item tables. Item IDs from the import (INV-<centre>-<number>)
 * are long; the location table uses the same width so the columns line up on a location's page.
 */
export const codeColumnWidth = 'w-44';

/**
 * Makes a link of a table cell cover its whole row: put these classes and `data-row-link` on the
 * `<a>` of the row's primary cell. The row lights up on hover, and a click anywhere on it follows
 * the link, which stays the one real link (keyboard, screen reader, open in a new tab).
 */
export const rowLinkClass = "after:absolute after:inset-0 after:content-['']";

// Tailwind's `md` breakpoint.
const wideScreen = '(min-width: 768px)';

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
 * with retry, empty, nothing found, and the rows with a "load more" button. The rows are a table
 * on wide screens and cards on narrow ones (only one of them is rendered). While a new search is
 * loading the previous rows stay on screen (dimmed) instead of flashing a skeleton.
 */
export function PagedList<T extends { id: string }>({
  query,
  searching,
  empty,
  columns,
  card,
  fill,
}: Props<T>) {
  const { t } = useTranslation();
  const wide = useMediaQuery(wideScreen);
  const { data } = query;

  if (!data) {
    if (query.isError) {
      return <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />;
    }
    return <ListSkeleton />;
  }

  const items = data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    // An empty result of the previous search is only a stand-in; the new one has not answered yet.
    if (query.isPlaceholderData) return <ListSkeleton />;
    return searching ? (
      <EmptyState title={t('states.noResultsTitle')} hint={t('states.noResultsHint')} />
    ) : (
      <EmptyState title={empty.title} hint={empty.hint} />
    );
  }

  return (
    <div aria-busy={query.isPlaceholderData} className={query.isPlaceholderData ? 'opacity-60' : undefined}>
      {wide && columns ? (
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="divide-x divide-line border-b border-line bg-primary-soft text-xs font-bold tracking-wide text-secondary-foreground uppercase">
              {columns.map((column) => (
                <th key={column.header} scope="col" className={cn('h-12 px-4 py-2', column.className)}>
                  {column.header}
                </th>
              ))}
              {fill ? <td aria-hidden colSpan={fill} /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item) => (
              <tr key={item.id} className="relative divide-x divide-line has-[[data-row-link]]:hover:bg-accent">
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={cn(
                      'h-12 overflow-hidden px-4 py-3 align-middle text-sm text-ellipsis whitespace-nowrap text-foreground/80',
                      column.primary && 'text-[15px] font-semibold text-foreground',
                      column.className,
                    )}
                  >
                    {column.cell(item)}
                  </td>
                ))}
                {fill ? <td aria-hidden colSpan={fill} /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              {card(item)}
            </li>
          ))}
        </ul>
      )}
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
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
