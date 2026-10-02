import { jsonResponse } from './helpers.tsx';

/** Plain-data stand-ins for what the API answers, shared by the screen tests. */
export const ref = (code: string, name: string) => ({ id: crypto.randomUUID(), code, name });
export const record = { version: 1, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

export function location(over: Record<string, unknown> = {}) {
  return {
    ...record,
    id: crypto.randomUUID(),
    code: 'LOC-001',
    name: 'Centrála Praha',
    parentId: null,
    type: ref('HQ', 'Centrála'),
    address: 'Vinohradská 12, Praha',
    note: null,
    path: [ref('LOC-001', 'Centrála Praha')],
    itemCount: 38,
    childCount: 4,
    ...over,
  };
}

export function item(over: Record<string, unknown> = {}) {
  const place = ref('LOC-019', 'Teplá kuchyně');
  return {
    ...record,
    id: crypto.randomUUID(),
    code: 'INV-00042',
    name: 'Konvektomat',
    model: 'SCC 101',
    serialNumber: null,
    manufacturer: { id: crypto.randomUUID(), name: 'Rational' },
    location: place,
    path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí'), place],
    warrantyUntil: null,
    lastServiceOn: null,
    nextServiceOn: null,
    ...over,
  };
}

export const page = (items: unknown[], extra: { nextCursor?: string | null; total?: number } = {}) =>
  jsonResponse({ items, nextCursor: extra.nextCursor ?? null, total: extra.total ?? items.length });

/** A row of the all-items service record list. */
export function recordListEntry(over: Record<string, unknown> = {}) {
  const place = ref('LOC-019', 'Teplá kuchyně');
  return {
    ...record,
    id: crypto.randomUUID(),
    performedOn: '2026-04-15',
    title: 'Výměna filtru a kontrola tlaku',
    item: ref('INV-00042', 'Kávovar Linea PB'),
    location: place,
    path: [ref('LOC-001', 'Centrála Praha'), ref('LOC-004', 'Přízemí výroba'), place],
    ...over,
  };
}
