import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createServiceRecordService, serviceRecordRepos } from '../../../src/modules/service-records/service.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertUser } from '../../helpers/factories.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database.
describe('service record service with the database', () => {
  const t = useTestDb();

  it('creates, edits and archives a record with an audit entry for each step', async () => {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const service = createServiceRecordService({
      repos: serviceRecordRepos(t().app),
      transact: transactor(t().app, serviceRecordRepos),
    });
    const item = await insertItem(t().app, { name: 'Kávovar' });

    const created = await service.create(actor, item.id, { performedOn: '2026-04-15', title: 'Výměna filtru' });
    expect(created.item).toMatchObject({ id: item.id, name: 'Kávovar', archivedAt: null });
    await service.update(actor, created.id, { version: 1, performedBy: 'Servis Novák' });
    await service.archive(actor, created.id, 2);

    expect(await service.listByItem(actor, item.id, { limit: 50 })).toMatchObject({ items: [], total: 0 });
    const history = await serviceRecordRepos(t().app).audit.list(
      { entityType: 'service_record', entityId: created.id },
      { limit: 10 },
    );
    expect(history.items.map((e) => e.action)).toEqual(['archive', 'update', 'create']);
  });
});
