// One-off update of the database from the accounting workbook: numbers every item INV-0001,
// INV-0002..., keeps the accounting number and the old code as external IDs, fills in what the
// workbook knows and adds the items it lists that the database lacks. Everything runs in one
// transaction, with the same audit entries a person's edit would leave. Without `apply` it only
// plans (read-only transaction), which is the dry run to review. See `plan.ts` for the rules.
//
// `apply` locks the items table, sets the code sequence (needs its owner) and writes; run it with
// the owner's connection (MIGRATION_DATABASE_URL), like a migration.

import { eq, inArray, sql } from 'drizzle-orm';
import { createAuditRepository } from '../../modules/audit/repository.ts';
import { createItemRepository } from '../../modules/items/repository.ts';
import { createLocationRepository, createLocationTypeRepository } from '../../modules/locations/repository.ts';
import type { Db } from '../client.ts';
import { itemExternalIds, items, locations, user } from '../schema/index.ts';
import {
  type Decisions,
  type ExternalIdPair,
  type Plan,
  type PlanItem,
  parseAccountingCsv,
  planAccountingUpdate,
} from './plan.ts';

export type UpdateOptions = {
  /** The workbook as CSV, see `ACCOUNTING_COLUMNS`. */
  rowsCsv: string;
  decisions: Decisions;
  apply: boolean;
  /** The fingerprint of the reviewed dry run; an apply refuses a plan that differs. */
  expect?: string;
  /** The user the changes are attributed to (created_by, updated_by, audit). */
  actorEmail: string;
};

export type UpdateResult = { plan: Plan; applied: boolean };

export class PlanChangedError extends Error {
  constructor(expected: string, actual: string) {
    super(`The plan differs from the reviewed one (expected ${expected}, got ${actual}); run the dry run again.`);
    this.name = 'PlanChangedError';
  }
}

export async function runAccountingUpdate(db: Db, options: UpdateOptions): Promise<UpdateResult> {
  const rows = parseAccountingCsv(options.rowsCsv);

  return db.transaction(async (tx) => {
    if (options.apply) await tx.execute(sql`LOCK TABLE items IN SHARE ROW EXCLUSIVE MODE`);
    else await tx.execute(sql`SET TRANSACTION READ ONLY`);

    const [actor] = await tx.select({ id: user.id }).from(user).where(eq(user.email, options.actorEmail));
    if (!actor) throw new Error(`No user ${options.actorEmail} to attribute the changes to`);

    const locationRows = await tx
      .select({ id: locations.id, code: locations.code, name: locations.name })
      .from(locations);
    const idsByItem = new Map<string, ExternalIdPair[]>();
    for (const e of await tx.select().from(itemExternalIds)) {
      idsByItem.set(e.itemId, [...(idsByItem.get(e.itemId) ?? []), { source: e.source, value: e.value }]);
    }
    const snapshot: PlanItem[] = (await tx.select().from(items)).map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      locationId: i.locationId,
      registeredOn: i.registeredOn,
      purchasePrice: i.purchasePrice,
      note: i.note,
      version: i.version,
      externalIds: idsByItem.get(i.id) ?? [],
    }));

    const plan = planAccountingUpdate({ rows, locations: locationRows, items: snapshot, decisions: options.decisions });
    if (!options.apply) return { plan, applied: false };
    if (options.expect !== undefined && options.expect !== plan.fingerprint) {
      throw new PlanChangedError(options.expect, plan.fingerprint);
    }

    const by = actor.id;
    const itemRepo = createItemRepository(tx);
    const locationRepo = createLocationRepository(tx);
    const audit = createAuditRepository(tx);
    const locationIds = new Map(locationRows.map((l) => [l.code, l.id]));

    // New locations.
    const types = new Map((await createLocationTypeRepository(tx).list()).map((t) => [t.code, t.id]));
    for (const l of plan.newLocations) {
      const typeId = types.get(l.type);
      if (!typeId) throw new Error(`location ${l.code}: unknown location type "${l.type}"`);
      const row = await locationRepo.insert({
        code: l.code,
        name: l.name,
        parentId: null,
        locationTypeId: typeId,
        address: null,
        note: null,
        createdBy: by,
      });
      locationIds.set(l.code, row.id);
      await audit.record({
        userId: by,
        entityType: 'location',
        entityId: row.id,
        action: 'create',
        changes: { code: { from: null, to: l.code }, name: { from: null, to: l.name } },
      });
    }

    // An item that holds a code another item is about to get steps aside first (codes are unique
    // and checked row by row, not at the end of the statement).
    const wanted = new Set([...plan.updates.map((u) => u.newCode), ...plan.creates.map((c) => c.newCode)]);
    const inTheWay = snapshot.filter((i) => wanted.has(i.code)).map((i) => i.id);
    if (inTheWay.length > 0) {
      await tx.update(items).set({ code: sql`'TMP-' || ${items.id}::text` }).where(inArray(items.id, inTheWay));
    }

    for (const u of plan.updates) {
      await tx
        .update(items)
        .set({ code: u.newCode, ...u.fields, updatedBy: by })
        .where(eq(items.id, u.itemId));
      if (u.externalIdsChanged) await itemRepo.replaceExternalIds(u.itemId, u.externalIds, by);
      await audit.record({ userId: by, entityType: 'item', entityId: u.itemId, action: 'update', changes: u.changes });
    }

    for (const c of plan.creates) {
      const locationId = locationIds.get(c.locationCode);
      if (!locationId) throw new Error(`item ${c.key}: no location ${c.locationCode}`);
      const row = await itemRepo.insert({
        code: c.newCode,
        name: c.name,
        locationId,
        registeredOn: c.registeredOn,
        purchasePrice: c.purchasePrice,
        note: c.note,
        createdBy: by,
      });
      await itemRepo.replaceExternalIds(row.id, c.externalIds, by);
      await audit.record({
        userId: by,
        entityType: 'item',
        entityId: row.id,
        action: 'create',
        changes: {
          code: { from: null, to: c.newCode },
          name: { from: null, to: c.name },
          locationId: { from: null, to: locationId },
          registeredOn: { from: null, to: c.registeredOn },
          purchasePrice: { from: null, to: c.purchasePrice },
          note: { from: null, to: c.note },
          externalIds: { from: null, to: c.externalIds.map((e) => `${e.source}: ${e.value}`) },
        },
      });
    }

    // The next item created in the app gets the next number.
    await tx.execute(sql`SELECT setval('item_code_seq', ${plan.lastNumber})`);

    const [{ total, numbered }] = (
      await tx.execute<{ total: number; numbered: number }>(
        sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE code ~ '^INV-[0-9]{4,}$')::int AS numbered FROM items`,
      )
    ).rows as [{ total: number; numbered: number }];
    if (total !== plan.lastNumber || numbered !== total) {
      throw new Error(`Verification failed: ${total} items, ${numbered} numbered, ${plan.lastNumber} expected`);
    }
    return { plan, applied: true };
  });
}
