import { api, unwrap } from '@/lib/api';

/** Manufacturers (brands) matching `q`, for a picker; `exclude` leaves out the ones already chosen. */
export const manufacturerPickerOptions = (q: string, exclude: readonly string[] = []) => ({
  queryKey: ['manufacturers', 'picker', q, exclude.join(',')] as const,
  queryFn: async () => {
    const page = await unwrap(api.api.v1.manufacturers.$get({ query: { q: q || undefined, limit: '20' } }));
    return page.items
      .filter((manufacturer) => !exclude.includes(manufacturer.id))
      .map((manufacturer) => ({ id: manufacturer.id, label: manufacturer.name }));
  },
});

export async function createManufacturer(name: string) {
  const created = await unwrap(api.api.v1.manufacturers.$post({ json: { name } }));
  return { id: created.id, label: created.name };
}
