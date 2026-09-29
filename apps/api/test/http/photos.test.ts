import { randomUUID } from 'node:crypto';
import {
  itemDetailSchema,
  photoListSchema,
  photoSchema,
  uploadTargetSchema,
} from '@inventory/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, itemPhotos, items } from '../../src/db/schema/index.ts';
import { MAX_PHOTO_BYTES } from '../../src/modules/photos/storage.ts';
import { createTestApp } from '../helpers/app.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertItem, insertLocation } from '../helpers/factories.ts';
import { expectJson, expectProblem, roleClients } from '../helpers/http.ts';

const db = useTestDb();

const MISSING = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';
const SIZE = { width: 2048, height: 1536 };

async function setup() {
  const { app, bucket } = createTestApp(db().app);
  const clients = await roleClients(app, db().app);
  const item = await insertItem(db().app, { name: 'Konvektomat', locationId: (await insertLocation(db().app)).id });
  type Client = (typeof clients)['write'];

  /** Both steps of adding a photo: ask for the URL, "upload" the file, confirm it. */
  const addPhoto = async (itemId = item.id, client: Client = clients.write, contentType = 'image/jpeg') => {
    const target = await expectJson(
      await client.post(`/items/${itemId}/photos/upload-url`, { contentType }),
      200,
      uploadTargetSchema,
    );
    bucket.upload(target.key, { contentType });
    return expectJson(await client.post(`/items/${itemId}/photos`, { key: target.key, ...SIZE }), 201, photoSchema);
  };
  const gallery = async (itemId = item.id) =>
    (await expectJson(await clients.read.get(`/items/${itemId}`), 200, itemDetailSchema)).photos;
  const archive = (itemId = item.id) =>
    db().app.update(items).set({ archivedAt: new Date() }).where(eq(items.id, itemId));
  return { ...clients, bucket, item, addPhoto, gallery, archive };
}

async function auditOf(entityType: 'item' | 'photo', id: string) {
  return db()
    .app.select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, id)))
    .orderBy(auditLog.id);
}

describe('adding a photo', () => {
  it('takes two steps and puts the photo in the item detail with a 15-minute read URL', async () => {
    const { write, read, bucket, item, addPhoto, gallery } = await setup();
    expect(await gallery()).toEqual([]);

    const target = await expectJson(
      await write.post(`/items/${item.id}/photos/upload-url`, { contentType: 'image/webp' }),
      200,
      uploadTargetSchema,
    );
    expect(target.key).toMatch(new RegExp(`^items/${item.id}/[0-9a-f-]{36}\\.webp$`));
    expect(target.uploadUrl).toContain(target.key);
    expect(bucket.uploadUrls).toEqual([{ key: target.key, contentType: 'image/webp', maxBytes: MAX_PHOTO_BYTES }]);
    // Nothing is recorded until the upload is confirmed.
    expect(await gallery()).toEqual([]);

    bucket.upload(target.key, { contentType: 'image/webp', size: 123_456 });
    const photo = await expectJson(
      await write.post(`/items/${item.id}/photos`, { key: target.key, ...SIZE }),
      201,
      photoSchema,
    );
    expect(photo).toMatchObject({ contentType: 'image/webp', ...SIZE });
    expect(photo.url).toBe(`https://storage.test/${target.key}?ttl=900`);
    expect(photo).not.toHaveProperty('storageKey');

    const second = await addPhoto();
    const detail = await expectJson(await read.get(`/items/${item.id}`), 200, itemDetailSchema);
    expect(detail.photos.map((p) => p.id)).toEqual([photo.id, second.id]);
    expect(detail.photos[0]).toEqual(photo);
  });

  it('audits the new photo', async () => {
    const { item, addPhoto } = await setup();
    const photo = await addPhoto();
    const [entry, ...rest] = await auditOf('photo', photo.id);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'create', changes: { itemId: { from: null, to: item.id } } });
  });

  it('refuses a type that is not JPEG, PNG or WebP', async () => {
    const { write, item, bucket } = await setup();
    for (const contentType of ['image/gif', 'application/pdf', 'image/svg+xml']) {
      await expectProblem(
        await write.post(`/items/${item.id}/photos/upload-url`, { contentType }),
        422,
        'photo_type_not_allowed',
      );
    }
    expect(bucket.uploadUrls).toEqual([]);
  });

  it('answers 404 for an unknown item and 409 for an archived one', async () => {
    const { write, item, archive, bucket } = await setup();
    await expectProblem(await write.post(`/items/${MISSING}/photos/upload-url`, { contentType: 'image/png' }), 404, 'not_found');
    await archive();
    await expectProblem(await write.post(`/items/${item.id}/photos/upload-url`, { contentType: 'image/png' }), 409, 'archived');
    bucket.upload(`items/${item.id}/a.jpg`);
    await expectProblem(await write.post(`/items/${item.id}/photos`, { key: `items/${item.id}/a.jpg`, ...SIZE }), 409, 'archived');
    await expectProblem(await write.post(`/items/${MISSING}/photos`, { key: `items/${MISSING}/a.jpg`, ...SIZE }), 404, 'not_found');
  });

  it('validates the request bodies', async () => {
    const { write, item } = await setup();
    const url = `/items/${item.id}/photos/upload-url`;
    await expectProblem(await write.post(url, {}), 400, 'validation_error');
    await expectProblem(await write.post(url, { contentType: 'image/png', extra: 1 }), 400, 'validation_error');
    await expectProblem(await write.post('/items/nope/photos/upload-url', { contentType: 'image/png' }), 400, 'validation_error');
    const confirm = `/items/${item.id}/photos`;
    const key = `items/${item.id}/a.jpg`;
    for (const body of [
      {},
      { key },
      { key, width: 0, height: 100 },
      { key, width: 100, height: -1 },
      { key, width: 1.5, height: 100 },
      { key, width: 100, height: 100_000 },
      { key: '', width: 100, height: 100 },
      { key, width: 100, height: 100, extra: 1 },
    ]) {
      await expectProblem(await write.post(confirm, body), 400, 'validation_error');
    }
  });

  it('confirms only a file that is really in storage, and checks it there', async () => {
    const { write, item, bucket, gallery } = await setup();
    const other = await insertItem(db().app, { name: 'Sporák' });
    const request = async (contentType = 'image/jpeg') =>
      (await expectJson(await write.post(`/items/${item.id}/photos/upload-url`, { contentType }), 200, uploadTargetSchema)).key;
    const confirm = (key: string) => write.post(`/items/${item.id}/photos`, { key, ...SIZE });

    await expectProblem(await confirm(await request()), 422, 'photo_not_uploaded');

    const big = await request();
    bucket.upload(big, { size: MAX_PHOTO_BYTES + 1 });
    await expectProblem(await confirm(big), 422, 'photo_too_large');

    // The type of the stored file counts, not the one asked for.
    const disguised = await request();
    bucket.upload(disguised, { contentType: 'image/gif' });
    await expectProblem(await confirm(disguised), 422, 'photo_type_not_allowed');

    for (const key of [`items/${other.id}/x.jpg`, `items/${item.id}/nested/x.jpg`, `items/${item.id}/x.gif`, `${item.id}/x.jpg`]) {
      bucket.upload(key);
      await expectProblem(await confirm(key), 422, 'invalid_photo_key');
    }
    expect(await gallery()).toEqual([]);
  });

  it('answers 409 when the same upload is confirmed twice', async () => {
    const { write, item, addPhoto, gallery } = await setup();
    const photo = await addPhoto();
    const [row] = await db().app.select().from(itemPhotos).where(eq(itemPhotos.id, photo.id));
    await expectProblem(await write.post(`/items/${item.id}/photos`, { key: row!.storageKey, ...SIZE }), 409, 'conflict');
    expect(await gallery()).toHaveLength(1);
  });
});

describe('PATCH /items/{id}/photos/order', () => {
  it('sets the gallery order and answers with it', async () => {
    const { write, item, addPhoto, gallery } = await setup();
    const [a, b, c] = [await addPhoto(), await addPhoto(), await addPhoto()];

    const body = await expectJson(await write.patch(`/items/${item.id}/photos/order`, { photoIds: [c.id, a.id, b.id] }), 200, photoListSchema);
    expect(body.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect(body[0]?.url).toContain('?ttl=900');
    expect((await gallery()).map((p) => p.id)).toEqual([c.id, a.id, b.id]);

    const [entry] = await auditOf('item', item.id);
    expect(entry).toMatchObject({ action: 'update', changes: { photoOrder: { from: [a.id, b.id, c.id], to: [c.id, a.id, b.id] } } });
  });

  it('writes no audit entry when the order does not change', async () => {
    const { write, item, addPhoto } = await setup();
    const [a, b] = [await addPhoto(), await addPhoto()];
    await expectJson(await write.patch(`/items/${item.id}/photos/order`, { photoIds: [a.id, b.id] }), 200, photoListSchema);
    expect(await auditOf('item', item.id)).toEqual([]);
  });

  it('needs exactly the photos of this item, each once', async () => {
    const { write, item, addPhoto, gallery } = await setup();
    const other = await insertItem(db().app, { name: 'Sporák' });
    const [a, b] = [await addPhoto(), await addPhoto()];
    const foreign = await addPhoto(other.id);
    const order = (photoIds: string[]) => write.patch(`/items/${item.id}/photos/order`, { photoIds });

    for (const ids of [[a.id], [b.id, a.id, a.id], [a.id, b.id, foreign.id], [a.id, foreign.id], [a.id, b.id, randomUUID()], []]) {
      await expectProblem(await order(ids), 422, 'invalid_photo_order');
    }
    await expectProblem(await write.patch(`/items/${item.id}/photos/order`, { photoIds: ['nope'] }), 400, 'validation_error');
    await expectProblem(await write.patch(`/items/${item.id}/photos/order`, {}), 400, 'validation_error');
    expect((await gallery()).map((p) => p.id)).toEqual([a.id, b.id]);
    expect((await gallery(other.id)).map((p) => p.id)).toEqual([foreign.id]);
  });

  it('accepts an empty list for an item without photos, 404 for an unknown item, 409 for an archived one', async () => {
    const { write, item, addPhoto, archive } = await setup();
    await expectJson(await write.patch(`/items/${item.id}/photos/order`, { photoIds: [] }), 200, photoListSchema);
    await expectProblem(await write.patch(`/items/${MISSING}/photos/order`, { photoIds: [] }), 404, 'not_found');
    const photo = await addPhoto();
    await archive();
    await expectProblem(await write.patch(`/items/${item.id}/photos/order`, { photoIds: [photo.id] }), 409, 'archived');
  });
});

describe('DELETE /items/{id}/photos/{photoId}', () => {
  it('removes the photo and its stored file, and audits it', async () => {
    const { write, item, bucket, addPhoto, gallery } = await setup();
    const [a, b] = [await addPhoto(), await addPhoto()];
    const res = await write.delete(`/items/${item.id}/photos/${a.id}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect((await gallery()).map((p) => p.id)).toEqual([b.id]);
    expect(bucket.deleted).toHaveLength(1);
    expect(bucket.deleted[0]).toMatch(new RegExp(`^items/${item.id}/`));
    const entries = await auditOf('photo', a.id);
    expect(entries.map((e) => e.action)).toEqual(['create', 'delete']);
    expect(entries[1]).toMatchObject({ changes: { itemId: { from: item.id, to: null } } });
  });

  it('still succeeds when the stored file cannot be deleted', async () => {
    const { write, item, bucket, addPhoto, gallery } = await setup();
    const photo = await addPhoto();
    bucket.state.failDelete = true;
    expect((await write.delete(`/items/${item.id}/photos/${photo.id}`)).status).toBe(204);
    expect(await gallery()).toEqual([]);
  });

  it('answers 404 for an unknown photo or one of another item, 409 for an archived item', async () => {
    const { write, item, bucket, addPhoto, gallery, archive } = await setup();
    const other = await insertItem(db().app, { name: 'Sporák' });
    const photo = await addPhoto();
    const foreign = await addPhoto(other.id);

    await expectProblem(await write.delete(`/items/${item.id}/photos/${MISSING}`), 404, 'not_found');
    await expectProblem(await write.delete(`/items/${item.id}/photos/${foreign.id}`), 404, 'not_found');
    await expectProblem(await write.delete(`/items/${MISSING}/photos/${photo.id}`), 404, 'not_found');
    await expectProblem(await write.delete(`/items/${item.id}/photos/nope`), 400, 'validation_error');
    await archive();
    await expectProblem(await write.delete(`/items/${item.id}/photos/${photo.id}`), 409, 'archived');
    expect(await gallery()).toHaveLength(1);
    expect(await gallery(other.id)).toHaveLength(1);
    expect(bucket.deleted).toEqual([]);
  });
});

describe('the gallery in GET /items/{id}', () => {
  it('is still shown for an archived item, and readers get it too', async () => {
    const { read, item, addPhoto, archive } = await setup();
    const photo = await addPhoto();
    await archive();
    const detail = await expectJson(await read.get(`/items/${item.id}`), 200, itemDetailSchema);
    expect(detail.photos).toEqual([photo]);
  });

  it('keeps each item to its own photos', async () => {
    const { item, addPhoto, gallery } = await setup();
    const other = await insertItem(db().app, { name: 'Sporák' });
    const mine = await addPhoto();
    const theirs = await addPhoto(other.id);
    expect((await gallery(item.id)).map((p) => p.id)).toEqual([mine.id]);
    expect((await gallery(other.id)).map((p) => p.id)).toEqual([theirs.id]);
  });
});

describe('roles on the photo routes', () => {
  it('lets read users see photos but not change them', async () => {
    const { read, item, bucket, addPhoto, gallery } = await setup();
    const photo = await addPhoto();
    const key = `items/${item.id}/a.jpg`;
    bucket.upload(key);

    expect(await gallery()).toHaveLength(1);
    await expectProblem(await read.post(`/items/${item.id}/photos/upload-url`, { contentType: 'image/jpeg' }), 403, 'forbidden');
    await expectProblem(await read.post(`/items/${item.id}/photos`, { key, ...SIZE }), 403, 'forbidden');
    await expectProblem(await read.patch(`/items/${item.id}/photos/order`, { photoIds: [photo.id] }), 403, 'forbidden');
    await expectProblem(await read.delete(`/items/${item.id}/photos/${photo.id}`), 403, 'forbidden');
    expect(await gallery()).toHaveLength(1);
    expect(bucket.uploadUrls).toHaveLength(1);
    expect(bucket.deleted).toEqual([]);
  });

  it('lets write and admin users add photos', async () => {
    const { write, admin, item, addPhoto } = await setup();
    await addPhoto(item.id, write);
    await addPhoto(item.id, admin);
  });
});
