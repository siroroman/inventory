import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of items by name; `q` searches name, ID, serial number, external IDs, brand, model and location. */
export const itemListQueryOptions = (q: string) =>
  pagedListQueryOptions('items', q, (query) => unwrap(api.api.v1.items.$get({ query })));

/** One item with its photos (signed read links, valid for 15 minutes); archived items included. */
export const itemDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['items', 'detail', id],
    queryFn: () => unwrap(api.api.v1.items[':id'].$get({ param: { id } })),
  });
