import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { manufacturers } from '../../src/db/schema/index.ts';
import { setArchived, updateVersioned } from '../../src/db/versioned.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertManufacturer, insertUser } from '../helpers/factories.ts';

describe('versioned updates', () => {
  const t = useTestDb();

  it('update the row when the version matches', async () => {
    const user = await insertUser(t().app);
    const m = await insertManufacturer(t().app);
    const updated = await updateVersioned(t().app, manufacturers, m.id, 1, { note: 'x', updatedBy: user.id });
    expect(updated).toMatchObject({ note: 'x', version: 2, updatedBy: user.id });
  });

  it('return undefined for a stale version or an unknown id, without changing anything', async () => {
    const m = await insertManufacturer(t().app);
    await updateVersioned(t().app, manufacturers, m.id, 1, { note: 'first' });
    expect(await updateVersioned(t().app, manufacturers, m.id, 1, { note: 'second' })).toBeUndefined();
    expect(await updateVersioned(t().app, manufacturers, randomUUID(), 1, { note: 'x' })).toBeUndefined();
  });

  it('archive and restore', async () => {
    const user = await insertUser(t().app);
    const m = await insertManufacturer(t().app);
    const archived = await setArchived(t().app, manufacturers, m.id, 1, true, user.id);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    const restored = await setArchived(t().app, manufacturers, m.id, 2, false, user.id);
    expect(restored).toMatchObject({ archivedAt: null, version: 3 });
  });

  it('work inside a transaction', async () => {
    const m = await insertManufacturer(t().app);
    await t().app.transaction(async (tx) => {
      await updateVersioned(tx, manufacturers, m.id, 1, { note: 'in tx' });
    });
    expect(await updateVersioned(t().app, manufacturers, m.id, 2, { note: 'after' })).toMatchObject({ version: 3 });
  });
});
