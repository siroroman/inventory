import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Page } from '../../db/pagination.ts';
import { type AuditEntityType, type AuditListRow, type AuditRepository, createAuditRepository } from './repository.ts';

export type AuditRepos = { audit: AuditRepository };

export const auditRepos = (db: DbExecutor): AuditRepos => ({ audit: createAuditRepository(db) });

/** Reading the change history is admin-only. Entries are written by the other services. */
export function createAuditService({ repos }: { repos: AuditRepos }) {
  return {
    /** Changes of one record, newest first. */
    async history(
      actor: Actor,
      filter: { entityType: AuditEntityType; entityId: string },
      page: { limit: number; cursor?: string },
    ): Promise<Page<AuditListRow>> {
      assertRole(actor, 'admin');
      return repos.audit.list(filter, page);
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
