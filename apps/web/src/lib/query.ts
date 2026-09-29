import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api.ts';
import { problemMessage } from './problem.ts';

declare module '@tanstack/react-query' {
  interface Register {
    /** `silentError`: the caller shows the error itself (e.g. a form's field errors or a 409). */
    mutationMeta: { silentError?: boolean };
  }
}

/** How many rows a list asks for at a time; "Načíst další" fetches the next page. */
export const listPageSize = 20;

/** Client errors (4xx) will not change on a retry; network and server errors might. */
export function retryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * Failed queries are shown by their screen (inline error with a retry button). Failed mutations
 * toast the Czech message unless the mutation opts out with `meta: { silentError: true }`.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: retryQuery } },
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) => {
        if (!mutation.meta?.silentError) toast.error(problemMessage(error));
      },
    }),
  });
}
