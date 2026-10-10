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

/** A service provider ("supplier") with the brands it services (none by default), as the list and the edit answers have it. */
export function provider(over: Record<string, unknown> = {}) {
  return {
    ...record,
    id: crypto.randomUUID(),
    code: 'SUP-001',
    name: 'Servis Novák s.r.o.',
    contactPerson: 'Jan Novák',
    phone: '+420 601 123 456',
    email: 'servis@novak-sro.cz',
    web: 'https://www.novak-servis.cz',
    note: 'Rychlá reakce, servis do 24 hodin.',
    manufacturers: [] as unknown[],
    ...over,
  };
}

/** A provider with a brand it services, as `GET /service-providers/{id}` answers. */
export function providerDetail(over: Record<string, unknown> = {}) {
  return {
    ...provider(),
    manufacturers: [{ id: crypto.randomUUID(), name: 'La Marzocco', archivedAt: null, priority: 1 }],
    ...over,
  };
}

/** A provider as it ranks in a manufacturer's contact order. */
export const rankedProvider = (priority: number, over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  code: `SUP-00${priority}`,
  name: `Servis ${priority}`,
  contactPerson: null,
  phone: null,
  email: null,
  web: null,
  archivedAt: null,
  priority,
  ...over,
});

/** A manufacturer with its providers in contact order, as `GET /manufacturers/{id}` answers. */
export function manufacturerDetail(over: Record<string, unknown> = {}) {
  return {
    ...record,
    id: crypto.randomUUID(),
    name: 'La Marzocco',
    note: 'Italský výrobce profesionálních kávovarů.',
    providers: [] as unknown[],
    ...over,
  };
}

export const person = (name = 'Roman Siro') => ({ id: crypto.randomUUID(), name });

const noCounts = { expected: 0, checked: 0, elsewhere: 0, new: 0, missing: 0 };

/** A run as the Inventura tab lists it: in progress, started by Roman Siro, nothing checked yet. */
export function inventoryEntry(over: Record<string, unknown> = {}) {
  const root = ref('LOC-001', 'Centrála Praha');
  const starter = person();
  return {
    id: crypto.randomUUID(),
    status: 'in_progress',
    location: root,
    path: [root],
    startedAt: '2026-10-03T07:15:00.000Z',
    startedBy: starter,
    endedAt: null,
    endedBy: null,
    counts: { ...noCounts, expected: 128 },
    participants: [starter],
    ...over,
  };
}

/** A location of a run, with its path from the top (itself last). */
export function inventoryLocation(over: Record<string, unknown> = {}) {
  const self = ref('LOC-004', 'Sklad');
  return { ...self, path: [ref('LOC-001', 'Centrála Praha'), self], total: 10, checked: 0, extra: 0, missing: 0, participants: [] as unknown[], ...over };
}

/** A run as `GET /inventories/{id}` answers it. */
export function inventory(over: Record<string, unknown> = {}) {
  return {
    ...inventoryEntry(),
    version: 1,
    note: null,
    committee: null,
    activeNow: [] as unknown[],
    locations: [] as unknown[],
    ...over,
  };
}

/** A row of a run as `GET /inventories/{id}/items` answers it: on the list, not checked yet. */
export function inventoryRow(over: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    code: 'INV-00042',
    name: 'Kávovar Linea PB',
    kind: 'expected',
    locationId: crypto.randomUUID(),
    checkedAt: null as string | null,
    checkedBy: null as unknown,
    method: null as string | null,
    registeredPath: [] as unknown[],
    // A found item is registered elsewhere until its location is changed (override to say otherwise).
    registeredElsewhere: over.kind === 'elsewhere',
    moved: false,
    ...over,
  };
}
