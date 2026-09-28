import { and, desc, eq, getTableColumns, lt } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { decodeIdCursor, type Page, toPage } from '../../db/pagination.ts';
import { auditLog, user } from '../../db/schema/index.ts';

export type AuditAction = 'create' | 'update' | 'archive' | 'restore' | 'delete';
export type AuditEntityType =
  | 'location'
  | 'location_type'
  | 'item'
  | 'photo'
  | 'manufacturer'
  | 'service_provider'
  | 'user';

export type AuditEntry = typeof auditLog.$inferSelect;
export type AuditListRow = AuditEntry & { userName: string | null };
export type NewAuditEntry = {
  /** null for system changes (migrations, jobs). */
  userId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  changes?: Record<string, unknown>;
};

export function createAuditRepository(db: DbExecutor) {
  return {
    /** Call with the transaction that makes the change, so the entry commits or rolls back with it. */
    async record(entry: NewAuditEntry): Promise<AuditEntry> {
      const [row] = await db.insert(auditLog).values(entry).returning();
      return row!;
    },

    /** Change history of one record, newest first. */
    async list(
      filter: { entityType: AuditEntityType; entityId: string },
      page: { limit: number; cursor?: string },
    ): Promise<Page<AuditListRow>> {
      const rows = await db
        .select({ ...getTableColumns(auditLog), userName: user.name })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.userId))
        .where(
          and(
            eq(auditLog.entityType, filter.entityType),
            eq(auditLog.entityId, filter.entityId),
            page.cursor ? lt(auditLog.id, decodeIdCursor(page.cursor)) : undefined,
          ),
        )
        .orderBy(desc(auditLog.id))
        .limit(page.limit + 1);
      return toPage(rows, page.limit, (r) => ({ id: r.id }));
    },
  };
}

export type AuditRepository = ReturnType<typeof createAuditRepository>;
