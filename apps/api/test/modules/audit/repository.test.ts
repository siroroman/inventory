import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAuditRepository } from '../../../src/modules/audit/repository.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertUser } from '../../helpers/factories.ts';

describe('audit repository', () => {
  const t = useTestDb();
  const repo = () => createAuditRepository(t().app);

  it('records an entry with its change set', async () => {
    const user = await insertUser(t().app);
    const entityId = randomUUID();
    const entry = await repo().record({
      userId: user.id,
      entityType: 'item',
      entityId,
      action: 'update',
      changes: { name: { from: 'Stůl', to: 'Stůl jídelní' } },
    });
    expect(entry).toMatchObject({ entityId, action: 'update', changes: { name: { from: 'Stůl', to: 'Stůl jídelní' } } });
  });

  it('lists one record\'s history newest first, with the author\'s name, in pages', async () => {
    const user = await insertUser(t().app, { name: 'Jana Nováková' });
    const entityId = randomUUID();
    for (const action of ['create', 'update', 'archive'] as const) {
      await repo().record({ userId: user.id, entityType: 'location', entityId, action });
    }
    await repo().record({ userId: null, entityType: 'location', entityId, action: 'restore' });
    await repo().record({ userId: user.id, entityType: 'location', entityId: randomUUID(), action: 'create' });
    await repo().record({ userId: user.id, entityType: 'item', entityId, action: 'create' });

    const filter = { entityType: 'location', entityId } as const;
    const first = await repo().list(filter, { limit: 2 });
    const second = await repo().list(filter, { limit: 2, cursor: first.nextCursor! });
    expect(first.items.map((e) => [e.action, e.userName])).toEqual([['restore', null], ['archive', 'Jana Nováková']]);
    expect(second.items.map((e) => e.action)).toEqual(['update', 'create']);
    expect(second.nextCursor).toBeNull();
  });

  it('rolls back with the change it describes', async () => {
    const entityId = randomUUID();
    await expect(
      t().app.transaction(async (tx) => {
        await createAuditRepository(tx).record({ userId: null, entityType: 'item', entityId, action: 'create' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await repo().list({ entityType: 'item', entityId }, { limit: 10 })).items).toEqual([]);
  });
});
