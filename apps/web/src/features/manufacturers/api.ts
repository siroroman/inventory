import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';

/** Manufacturers (brands) matching `q`, for a picker; `exclude` leaves out the ones already chosen. */
export const manufacturerPickerOptions = (q: string, exclude: readonly string[] = []) => ({
  queryKey: ['manufacturers', 'picker', q, exclude.join(',')] as const,
  queryFn: async () => {
    // The left-out ones would take places of the page: ask for that many more.
    const limit = String(Math.min(100, 20 + exclude.length));
    const page = await unwrap(api.api.v1.manufacturers.$get({ query: { q: q || undefined, limit } }));
    return page.items
      .filter((manufacturer) => !exclude.includes(manufacturer.id))
      .slice(0, 20)
      .map((manufacturer) => ({ id: manufacturer.id, label: manufacturer.name }));
  },
});

export async function createManufacturer(name: string) {
  const created = await unwrap(api.api.v1.manufacturers.$post({ json: { name } }));
  return { id: created.id, label: created.name };
}

/** One manufacturer (brand) with its service providers in contact order; archived ones included. */
export const manufacturerQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['manufacturers', 'detail', id],
    queryFn: () => unwrap(api.api.v1.manufacturers[':id'].$get({ param: { id } })),
  });

/** Saves the whole contact order at once: the first id gets priority 1. */
export const setProviderOrder = (id: string, providerIds: string[]) =>
  unwrap(api.api.v1.manufacturers[':id']['service-providers'].$put({ param: { id }, json: { providerIds } }));
