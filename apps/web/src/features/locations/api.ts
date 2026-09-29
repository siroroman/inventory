import { api, unwrap } from '@/lib/api';
import { pagedListQueryOptions } from '@/lib/query';

/** Pages of locations by name: the top-level ones, or with `q` the matches at every level. */
export const locationListQueryOptions = (q: string) =>
  pagedListQueryOptions('locations', q, (query) => unwrap(api.api.v1.locations.$get({ query })));
