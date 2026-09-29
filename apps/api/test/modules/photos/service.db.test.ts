import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { transactor } from '../../../src/db/transaction.ts';
import { createPhotoService, photoRepos } from '../../../src/modules/photos/service.ts';
import { createFakeStorage } from '../../fakes/storage.ts';
import { useTestDb } from '../../helpers/db.ts';
import { insertItem, insertUser } from '../../helpers/factories.ts';
import { expectPgError, PG } from '../../helpers/pg-error.ts';

// The rules are unit-tested with fakes; this checks the wiring against a real database. The
// bucket stays a fake: the Cloud Storage adapter does not exist yet.
describe('photo service with the database', () => {
  const t = useTestDb();

  async function setup() {
    const user = await insertUser(t().app, { role: 'write' });
    const actor: Actor = { id: user.id, role: 'write' };
    const bucket = createFakeStorage();
    let counter = 0;
    const service = createPhotoService({
      repos: photoRepos(t().app),
      transact: transactor(t().app, photoRepos),
      storage: bucket.storage,
      newId: () => `photo${++counter}`,
    });
    const item = await insertItem(t().app);
    const addPhoto = async () => {
      const { key } = await service.requestUpload(actor, item.id, { contentType: 'image/jpeg' });
      bucket.upload(key);
      return service.confirm(actor, item.id, { key, width: 2048, height: 1536 });
    };
    return { actor, bucket, service, repos: photoRepos(t().app), item, addPhoto };
  }

  it('adds, reorders and removes photos, each change with its audit entry', async () => {
    const { actor, bucket, service, repos, item, addPhoto } = await setup();
    const [a, b] = [await addPhoto(), await addPhoto()];
    await service.reorder(actor, item.id, [b.id, a.id]);
    await service.remove(actor, item.id, a.id);

    expect((await service.list(actor, item.id)).map((p) => p.id)).toEqual([b.id]);
    expect(bucket.deleted).toEqual([a.storageKey]);
    const photoHistory = await repos.audit.list({ entityType: 'photo', entityId: a.id }, { limit: 10 });
    expect(photoHistory.items.map((e) => e.action)).toEqual(['delete', 'create']);
    const itemHistory = await repos.audit.list({ entityType: 'item', entityId: item.id }, { limit: 10 });
    expect(itemHistory.items.map((e) => e.action)).toEqual(['update']);
  });

  it('leaves nothing behind when the database rejects a write', async () => {
    const { actor, service, repos, item, addPhoto } = await setup();
    const photo = await addPhoto();
    await expectPgError(service.confirm(actor, item.id, { key: photo.storageKey, width: 1, height: 1 }), {
      code: PG.uniqueViolation,
      constraint: 'item_photos_storage_key_key',
    });
    expect(await repos.photos.count(item.id)).toBe(1);
  });
});
