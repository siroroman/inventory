import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { itemPhotos } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('item_photos', () => {
  const t = useTestDb();
  const photo = (itemId: string, overrides: Partial<typeof itemPhotos.$inferInsert> = {}) =>
    t()
      .app.insert(itemPhotos)
      .values({
        itemId,
        storageKey: `items/${itemId}/${randomUUID()}.jpg`,
        contentType: 'image/jpeg',
        width: 2048,
        height: 1536,
        ...overrides,
      });

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', async (contentType) => {
    const item = await insertItem(t().app);
    await photo(item.id, { contentType });
  });

  it.each(['image/heic', 'image/svg+xml', 'application/pdf', 'text/html'])('rejects %s', async (contentType) => {
    const item = await insertItem(t().app);
    await expectPgError(photo(item.id, { contentType }), {
      code: PG.checkViolation,
      constraint: 'item_photos_content_type_image',
    });
  });

  it.each([
    { width: 0, height: 100 },
    { width: 100, height: -1 },
  ])('rejects non-positive dimensions %j', async (size) => {
    const item = await insertItem(t().app);
    await expectPgError(photo(item.id, size), {
      code: PG.checkViolation,
      constraint: 'item_photos_dimensions_positive',
    });
  });

  it('rejects a reused storage key', async () => {
    const item = await insertItem(t().app);
    await photo(item.id, { storageKey: 'items/a.jpg' });
    await expectPgError(photo(item.id, { storageKey: 'items/a.jpg' }), {
      code: PG.uniqueViolation,
      constraint: 'item_photos_storage_key_key',
    });
  });

  it('rejects an unknown item', async () => {
    await expectPgError(photo(randomUUID()), {
      code: PG.foreignKeyViolation,
      constraint: 'item_photos_item_id_items_id_fk',
    });
  });
});
