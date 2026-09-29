import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of items by name; `q` searches name, ID, serial number, external IDs, brand, model and location. */
export const itemListQueryOptions = (q: string) =>
  pagedListQueryOptions('items', q, (query) => unwrap(api.api.v1.items.$get({ query })));
