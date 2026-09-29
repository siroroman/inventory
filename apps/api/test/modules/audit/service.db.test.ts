import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { auditRepos, createAuditService } from '../../../src/modules/audit/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertUser } from '../../helpers/factories.ts';

describe('audit service with the database', () => {
  const t = useTestDb();

  it('pages through the history and names the author', async () => {
    const author = await insertUser(t().app, { name: 'Jana Nováková', role: 'write' });
    const actor: Actor = { id: author.id, role: 'admin' };
    const repos = auditRepos(t().app);
    const service = createAuditService({ repos });
    const entityId = crypto.randomUUID();
    for (const action of ['create', 'update', 'archive'] as const) {
      await repos.audit.record({ userId: author.id, entityType: 'location', entityId, action });
    }

    const first = await service.history(actor, { entityType: 'location', entityId }, { limit: 2 });
    expect(first.items.map((e) => [e.action, e.userName])).toEqual([
      ['archive', 'Jana Nováková'],
      ['update', 'Jana Nováková'],
    ]);
    const second = await service.history(actor, { entityType: 'location', entityId }, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((e) => e.action)).toEqual(['create']);
    expect(second.nextCursor).toBeNull();
  });
});
