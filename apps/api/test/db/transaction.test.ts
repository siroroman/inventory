import { describe, expect, it } from 'vitest';
import { transactor } from '../../src/db/transaction.ts';
import { createAuditRepository } from '../../src/modules/audit/repository.ts';
import { createManufacturerRepository } from '../../src/modules/manufacturers/repository.ts';
import type { DbExecutor } from '../../src/db/client.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertUser } from '../helpers/factories.ts';

const repos = (db: DbExecutor) => ({
  manufacturers: createManufacturerRepository(db),
  audit: createAuditRepository(db),
});

describe('transactor', () => {
  const t = useTestDb();

  it('commits a change and its audit entry together', async () => {
    const user = await insertUser(t().app);
    const transact = transactor(t().app, repos);
    const m = await transact(async (r) => {
      const row = await r.manufacturers.insert({ name: 'Rational', createdBy: user.id });
      await r.audit.record({ userId: user.id, entityType: 'manufacturer', entityId: row.id, action: 'create' });
      return row;
    });
    const history = await repos(t().app).audit.list({ entityType: 'manufacturer', entityId: m.id }, { limit: 10 });
    expect(history.items).toHaveLength(1);
  });

  it('rolls both back when the work fails', async () => {
    const user = await insertUser(t().app);
    const transact = transactor(t().app, repos);
    await expect(
      transact(async (r) => {
        const row = await r.manufacturers.insert({ name: 'Rational', createdBy: user.id });
        await r.audit.record({ userId: user.id, entityType: 'manufacturer', entityId: row.id, action: 'create' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repos(t().app).manufacturers.count({})).toBe(0);
  });
});
