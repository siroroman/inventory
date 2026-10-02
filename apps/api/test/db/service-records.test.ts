import { sql } from 'drizzle-orm';
import { describe, it } from 'vitest';
import { serviceRecords } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertServiceRecord } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('service_records', () => {
  const t = useTestDb();

  it('rejects a blank title', async () => {
    const item = await insertItem(t().app);
    await expectPgError(insertServiceRecord(t().app, { itemId: item.id, title: '   ' }), {
      code: PG.checkViolation,
      constraint: 'service_records_title_not_blank',
    });
  });

  it('requires a date and an existing item', async () => {
    await expectPgError(
      t().app.insert(serviceRecords).values({ itemId: crypto.randomUUID(), performedOn: '2026-04-15', title: 'X' }),
      { code: PG.foreignKeyViolation, constraint: 'service_records_item_id_items_id_fk' },
    );
  });

  it('stops the item from being deleted while it has records', async () => {
    const record = await insertServiceRecord(t().app);
    await expectPgError(
      t().owner.execute(sql`DELETE FROM items WHERE id = ${record.itemId}`),
      { code: PG.foreignKeyViolation, constraint: 'service_records_item_id_items_id_fk' },
    );
  });
});
