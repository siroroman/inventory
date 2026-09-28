import type { AuditEntry, AuditRepository } from '../../src/modules/audit/repository.ts';

export function createFakeAuditRepository(entries: AuditEntry[] = []): AuditRepository & { entries: AuditEntry[] } {
  return {
    entries,
    async record(entry) {
      const row: AuditEntry = {
        id: entries.length + 1,
        occurredAt: new Date(),
        userId: entry.userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        changes: entry.changes ?? {},
      };
      entries.push(row);
      return row;
    },
    async list(filter, page) {
      const rows = entries
        .filter((e) => e.entityType === filter.entityType && e.entityId === filter.entityId)
        .reverse()
        .map((e) => ({ ...e, userName: null }));
      return { items: rows.slice(0, page.limit), nextCursor: null };
    },
  };
}
