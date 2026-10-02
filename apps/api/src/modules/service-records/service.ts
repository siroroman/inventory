import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { changedFields, initialFields } from '../audit/changes.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createItemRepository, type Item, type ItemRepository } from '../items/repository.ts';
import {
  createLocationRepository,
  type LocationRepository,
  type PathSegment,
} from '../locations/repository.ts';
import {
  createServiceRecordRepository,
  type ServiceRecord,
  type ServiceRecordFilter,
  type ServiceRecordListRow,
  type ServiceRecordRepository,
} from './repository.ts';

export type ServiceRecordRepos = {
  serviceRecords: ServiceRecordRepository;
  /** Read-only here: records belong to an existing, active item. */
  items: ItemRepository;
  /** Read-only: the location paths of the all-items list. */
  locations: LocationRepository;
  audit: AuditRepository;
};

export const serviceRecordRepos = (db: DbExecutor): ServiceRecordRepos => ({
  serviceRecords: createServiceRecordRepository(db),
  items: createItemRepository(db),
  locations: createLocationRepository(db),
  audit: createAuditRepository(db),
});

/** `repos` serves reads; every write runs through `transact` together with its audit entry. */
export type ServiceRecordDeps = { repos: ServiceRecordRepos; transact: Transact<ServiceRecordRepos> };

/** The item a record belongs to, as much as the record's screens need. */
export type ServiceRecordItem = { id: string; code: string; name: string; archivedAt: Date | null };
export type ServiceRecordDetail = ServiceRecord & { item: ServiceRecordItem };
export type ServiceRecordListEntry = ServiceRecordListRow & { path: PathSegment[] };

export type CreateServiceRecordInput = {
  performedOn: string;
  title: string;
  performedBy?: string | null;
  responsiblePerson?: string | null;
  description?: string | null;
};
export type UpdateServiceRecordInput = Partial<CreateServiceRecordInput> & { version: number };

const AUDITED = ['performedOn', 'title', 'performedBy', 'responsiblePerson', 'description'] as const;

const itemRef = ({ id, code, name, archivedAt }: Item): ServiceRecordItem => ({ id, code, name, archivedAt });

async function loadItem(r: ServiceRecordRepos, itemId: string): Promise<Item> {
  const item = await r.items.findById(itemId);
  if (!item) throw new DomainError('not_found');
  return item;
}

/** Records are added to and changed under an active item only. */
async function loadActiveItem(r: ServiceRecordRepos, itemId: string): Promise<Item> {
  const item = await loadItem(r, itemId);
  if (item.archivedAt) throw new DomainError('archived');
  return item;
}

async function loadCurrent(r: ServiceRecordRepos, id: string, version: number): Promise<ServiceRecord> {
  const current = await r.serviceRecords.findById(id);
  if (!current) throw new DomainError('not_found');
  if (current.version !== version) throw new DomainError('conflict');
  return current;
}

/** Service history of items: what was done, when, by whom. */
export function createServiceRecordService({ repos, transact }: ServiceRecordDeps) {
  async function setArchived(actor: Actor, id: string, version: number, archive: boolean): Promise<ServiceRecordDetail> {
    assertRole(actor, 'write');
    return transact(async (r) => {
      const current = await loadCurrent(r, id, version);
      const item = await loadActiveItem(r, current.itemId);
      if (archive && current.archivedAt) throw new DomainError('archived');
      if (!archive && !current.archivedAt) throw new DomainError('not_archived');
      const row = await r.serviceRecords.setArchived(id, version, archive, actor.id);
      if (!row) throw new DomainError('conflict');
      await r.audit.record({
        userId: actor.id,
        entityType: 'service_record',
        entityId: id,
        action: archive ? 'archive' : 'restore',
      });
      return { ...row, item: itemRef(item) };
    });
  }

  return {
    /** Newest first, plus the total for the section heading. Archived items still list their records. */
    async listByItem(
      actor: Actor,
      itemId: string,
      page: { limit: number; cursor?: string },
    ): Promise<Page<ServiceRecord> & { total: number }> {
      assertRole(actor, 'read');
      await loadItem(repos, itemId);
      const [result, total] = await Promise.all([
        repos.serviceRecords.listByItem(itemId, page),
        repos.serviceRecords.countByItem(itemId),
      ]);
      return { ...result, total };
    },

    /** Records of all items, newest first, with each item's location path and the total for the list heading. */
    async list(
      actor: Actor,
      filter: ServiceRecordFilter,
      page: { limit: number; cursor?: string },
    ): Promise<Page<ServiceRecordListEntry> & { total: number }> {
      assertRole(actor, 'read');
      const [result, total] = await Promise.all([
        repos.serviceRecords.list(filter, page),
        repos.serviceRecords.count(filter),
      ]);
      const paths = await repos.locations.findPaths([
        ...new Set(result.items.flatMap((row) => (row.location ? [row.location.id] : []))),
      ]);
      return {
        items: result.items.map((row) => ({ ...row, path: (row.location && paths.get(row.location.id)) || [] })),
        nextCursor: result.nextCursor,
        total,
      };
    },

    /** Archived records are returned too, so they can be viewed (and later restored). */
    async get(actor: Actor, id: string): Promise<ServiceRecordDetail> {
      assertRole(actor, 'read');
      const row = await repos.serviceRecords.findById(id);
      if (!row) throw new DomainError('not_found');
      return { ...row, item: itemRef(await loadItem(repos, row.itemId)) };
    },

    async create(actor: Actor, itemId: string, input: CreateServiceRecordInput): Promise<ServiceRecordDetail> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const item = await loadActiveItem(r, itemId);
        const row = await r.serviceRecords.insert({
          itemId,
          performedOn: input.performedOn,
          title: input.title,
          performedBy: input.performedBy ?? null,
          responsiblePerson: input.responsiblePerson ?? null,
          description: input.description ?? null,
          createdBy: actor.id,
        });
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_record',
          entityId: row.id,
          action: 'create',
          changes: { itemId: { from: null, to: itemId }, ...initialFields(row, AUDITED) },
        });
        return { ...row, item: itemRef(item) };
      });
    },

    async update(actor: Actor, id: string, input: UpdateServiceRecordInput): Promise<ServiceRecordDetail> {
      assertRole(actor, 'write');
      return transact(async (r) => {
        const current = await loadCurrent(r, id, input.version);
        const item = await loadActiveItem(r, current.itemId);
        if (current.archivedAt) throw new DomainError('archived');
        const patch = Object.fromEntries(AUDITED.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
        const updated = await r.serviceRecords.update(id, input.version, { ...patch, updatedBy: actor.id });
        if (!updated) throw new DomainError('conflict');
        await r.audit.record({
          userId: actor.id,
          entityType: 'service_record',
          entityId: id,
          action: 'update',
          changes: changedFields(current, updated, AUDITED),
        });
        return { ...updated, item: itemRef(item) };
      });
    },

    archive: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, true),
    restore: (actor: Actor, id: string, version: number) => setArchived(actor, id, version, false),
  };
}

export type ServiceRecordService = ReturnType<typeof createServiceRecordService>;
