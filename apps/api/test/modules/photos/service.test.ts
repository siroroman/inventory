import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '../../../src/auth/roles.ts';
import { DomainError, type ErrorCode } from '../../../src/errors.ts';
import { createPhotoService } from '../../../src/modules/photos/service.ts';
import { MAX_PHOTO_BYTES } from '../../../src/modules/photos/storage.ts';
import { createFakePhotoStore } from '../../fakes/photos.ts';
import { createFakeStorage } from '../../fakes/storage.ts';

const actor = (role: Role): Actor => ({ id: `user-${role}`, role });
const reader = actor('read');
const writer = actor('write');
const admin = actor('admin');

async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}

async function setup() {
  const store = createFakePhotoStore();
  const bucket = createFakeStorage();
  let counter = 0;
  const service = createPhotoService({ ...store, storage: bucket.storage, newId: () => `photo${++counter}` });
  const item = await store.addItem();
  /** Requests an upload, "uploads" the file and confirms it. */
  const addPhoto = async (itemId = item.id, object: { size?: number; contentType?: string } = {}) => {
    const { key } = await service.requestUpload(writer, itemId, { contentType: 'image/jpeg' });
    bucket.upload(key, object);
    return service.confirm(writer, itemId, { key, width: 2048, height: 1536 });
  };
  return { store, bucket, service, item, addPhoto };
}

describe('photo service', () => {
  describe('roles', () => {
    it('lets readers view but not change anything', async () => {
      const { store, bucket, service, item, addPhoto } = await setup();
      const photo = await addPhoto();
      const auditBefore = store.state.audit.length;

      await expect(service.list(reader, item.id)).resolves.toHaveLength(1);
      await expectCode(service.requestUpload(reader, item.id, { contentType: 'image/jpeg' }), 'forbidden');
      await expectCode(service.confirm(reader, item.id, { key: photo.storageKey, width: 1, height: 1 }), 'forbidden');
      await expectCode(service.reorder(reader, item.id, [photo.id]), 'forbidden');
      await expectCode(service.remove(reader, item.id, photo.id), 'forbidden');

      expect(store.state.photos).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
      expect(bucket.deleted).toEqual([]);
    });

    it('lets writers and admins add photos', async () => {
      const { service, item } = await setup();
      await expect(service.requestUpload(writer, item.id, { contentType: 'image/png' })).resolves.toBeDefined();
      await expect(service.requestUpload(admin, item.id, { contentType: 'image/png' })).resolves.toBeDefined();
    });
  });

  describe('requestUpload', () => {
    it('returns a key under the item and a signed URL limited to 10 MB and the type', async () => {
      const { bucket, service, item } = await setup();
      const target = await service.requestUpload(writer, item.id, { contentType: 'image/webp' });
      expect(target).toEqual({ key: `items/${item.id}/photo1.webp`, uploadUrl: `https://storage.test/upload/items/${item.id}/photo1.webp` });
      expect(bucket.uploadUrls).toEqual([{ key: target.key, contentType: 'image/webp', maxBytes: MAX_PHOTO_BYTES }]);
    });

    it('accepts only jpeg, png and webp', async () => {
      const { service, item } = await setup();
      await expectCode(service.requestUpload(writer, item.id, { contentType: 'image/gif' }), 'photo_type_not_allowed');
      await expectCode(service.requestUpload(writer, item.id, { contentType: 'application/pdf' }), 'photo_type_not_allowed');
    });

    it('needs an existing, active item', async () => {
      const { store, service, item } = await setup();
      await expectCode(service.requestUpload(writer, randomUUID(), { contentType: 'image/jpeg' }), 'not_found');
      store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
      await expectCode(service.requestUpload(writer, item.id, { contentType: 'image/jpeg' }), 'archived');
    });
  });

  describe('confirm', () => {
    it('records the photo at the end of the gallery with the stored type, and audits it', async () => {
      const { store, service, item, addPhoto } = await setup();
      const first = await addPhoto();
      const second = await addPhoto(item.id, { contentType: 'image/png' });

      expect(first.url).toBe(`https://storage.test/${first.storageKey}?ttl=900`);
      expect(first).toMatchObject({ itemId: item.id, sortOrder: 1, contentType: 'image/jpeg', width: 2048, height: 1536, createdBy: writer.id });
      expect(second).toMatchObject({ sortOrder: 2, contentType: 'image/png' });
      expect(store.state.audit.at(-1)).toMatchObject({
        userId: writer.id,
        entityType: 'photo',
        entityId: second.id,
        action: 'create',
        changes: { itemId: { from: null, to: item.id }, storageKey: { from: null, to: second.storageKey } },
      });
      expect((await service.list(reader, item.id)).map((p) => p.id)).toEqual([first.id, second.id]);
    });

    it('rejects a key that does not belong to the item', async () => {
      const { store, bucket, service, item } = await setup();
      const other = await store.addItem('Sporák');
      for (const key of [
        `items/${other.id}/photo1.jpg`,
        `items/${item.id}/../${other.id}/photo1.jpg`,
        `items/${item.id}/nested/photo1.jpg`,
        `items/${item.id}/photo1.gif`,
        `other/${item.id}/photo1.jpg`,
      ]) {
        bucket.upload(key);
        await expectCode(service.confirm(writer, item.id, { key, width: 1, height: 1 }), 'invalid_photo_key');
      }
      expect(store.state.photos).toEqual([]);
    });

    it('rejects a file that was never uploaded', async () => {
      const { store, service, item } = await setup();
      const { key } = await service.requestUpload(writer, item.id, { contentType: 'image/jpeg' });
      await expectCode(service.confirm(writer, item.id, { key, width: 1, height: 1 }), 'photo_not_uploaded');
      expect(store.state.photos).toEqual([]);
    });

    it('checks the stored size and type instead of trusting the client', async () => {
      const { store, bucket, service, item } = await setup();
      const big = await service.requestUpload(writer, item.id, { contentType: 'image/jpeg' });
      bucket.upload(big.key, { size: MAX_PHOTO_BYTES + 1 });
      await expectCode(service.confirm(writer, item.id, { key: big.key, width: 1, height: 1 }), 'photo_too_large');

      const wrong = await service.requestUpload(writer, item.id, { contentType: 'image/jpeg' });
      bucket.upload(wrong.key, { contentType: 'application/pdf' });
      await expectCode(service.confirm(writer, item.id, { key: wrong.key, width: 1, height: 1 }), 'photo_type_not_allowed');

      const exact = await service.requestUpload(writer, item.id, { contentType: 'image/jpeg' });
      bucket.upload(exact.key, { size: MAX_PHOTO_BYTES });
      await expect(service.confirm(writer, item.id, { key: exact.key, width: 1, height: 1 })).resolves.toBeDefined();
      expect(store.state.photos).toHaveLength(1);
    });

    it('rolls back when the same file is confirmed twice', async () => {
      const { store, service, item, addPhoto } = await setup();
      const photo = await addPhoto();
      const auditBefore = store.state.audit.length;
      await expect(service.confirm(writer, item.id, { key: photo.storageKey, width: 1, height: 1 })).rejects.toMatchObject({
        constraint: 'item_photos_storage_key_key',
      });
      expect(store.state.photos).toHaveLength(1);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('needs an existing, active item', async () => {
      const { store, service, item, addPhoto } = await setup();
      const photo = await addPhoto();
      await expectCode(service.confirm(writer, randomUUID(), { key: photo.storageKey, width: 1, height: 1 }), 'not_found');
      store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
      await expectCode(service.confirm(writer, item.id, { key: photo.storageKey, width: 1, height: 1 }), 'archived');
    });
  });

  describe('list', () => {
    it('returns read URLs valid for 15 minutes, also for an archived item', async () => {
      const { store, service, item, addPhoto } = await setup();
      const photo = await addPhoto();
      store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
      expect(await service.list(reader, item.id)).toEqual([
        expect.objectContaining({ id: photo.id, url: `https://storage.test/${photo.storageKey}?ttl=900` }),
      ]);
    });

    it('reports an unknown item as not found', async () => {
      const { service } = await setup();
      await expectCode(service.list(reader, randomUUID()), 'not_found');
    });
  });

  describe('reorder', () => {
    it('sets the gallery order, audits it and returns the new order', async () => {
      const { store, service, item, addPhoto } = await setup();
      const [a, b, c] = [await addPhoto(), await addPhoto(), await addPhoto()];
      const result = await service.reorder(writer, item.id, [c.id, a.id, b.id]);
      expect(result.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
      expect(result.map((p) => p.url)).toEqual([c, a, b].map((p) => `https://storage.test/${p.storageKey}?ttl=900`));
      expect(store.state.audit.at(-1)).toMatchObject({
        entityType: 'item',
        entityId: item.id,
        action: 'update',
        changes: { photoOrder: { from: [a.id, b.id, c.id], to: [c.id, a.id, b.id] } },
      });
    });

    it('audits nothing when the order is unchanged', async () => {
      const { store, service, item, addPhoto } = await setup();
      const [a, b] = [await addPhoto(), await addPhoto()];
      const auditBefore = store.state.audit.length;
      await service.reorder(writer, item.id, [a.id, b.id]);
      expect(store.state.audit).toHaveLength(auditBefore);
    });

    it('needs exactly this item\'s photos, each once', async () => {
      const { store, service, item, addPhoto } = await setup();
      const [a, b] = [await addPhoto(), await addPhoto()];
      const other = await store.addItem('Sporák');
      const foreign = await addPhoto(other.id);

      await expectCode(service.reorder(writer, item.id, [a.id]), 'invalid_photo_order');
      await expectCode(service.reorder(writer, item.id, [a.id, a.id]), 'invalid_photo_order');
      await expectCode(service.reorder(writer, item.id, [a.id, b.id, foreign.id]), 'invalid_photo_order');
      await expectCode(service.reorder(writer, item.id, [a.id, foreign.id]), 'invalid_photo_order');
      expect((await service.list(reader, item.id)).map((p) => p.id)).toEqual([a.id, b.id]);
    });

    it('needs an existing, active item', async () => {
      const { store, service, item } = await setup();
      await expectCode(service.reorder(writer, randomUUID(), []), 'not_found');
      store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
      await expectCode(service.reorder(writer, item.id, []), 'archived');
    });
  });

  describe('remove', () => {
    it('deletes the row and the stored file and audits it', async () => {
      const { store, bucket, service, item, addPhoto } = await setup();
      const [a, b] = [await addPhoto(), await addPhoto()];
      await service.remove(writer, item.id, a.id);

      expect((await service.list(reader, item.id)).map((p) => p.id)).toEqual([b.id]);
      expect(bucket.deleted).toEqual([a.storageKey]);
      expect(bucket.objects.has(a.storageKey)).toBe(false);
      expect(store.state.audit.at(-1)).toMatchObject({
        entityType: 'photo',
        entityId: a.id,
        action: 'delete',
        changes: { storageKey: { from: a.storageKey, to: null } },
      });
    });

    it('still succeeds when the stored file cannot be deleted', async () => {
      const { store, bucket, service, item, addPhoto } = await setup();
      const photo = await addPhoto();
      bucket.state.failDelete = true;
      await expect(service.remove(writer, item.id, photo.id)).resolves.toBeUndefined();
      expect(store.state.photos).toEqual([]);
    });

    it('reports an unknown photo, or a photo of another item, as not found and keeps the file', async () => {
      const { store, bucket, service, item, addPhoto } = await setup();
      const other = await store.addItem('Sporák');
      const foreign = await addPhoto(other.id);
      await expectCode(service.remove(writer, item.id, randomUUID()), 'not_found');
      await expectCode(service.remove(writer, item.id, foreign.id), 'not_found');
      expect(store.state.photos).toHaveLength(1);
      expect(bucket.deleted).toEqual([]);
    });

    it('needs an existing, active item', async () => {
      const { store, service, item, addPhoto } = await setup();
      const photo = await addPhoto();
      await expectCode(service.remove(writer, randomUUID(), photo.id), 'not_found');
      store.itemStore.state.items.find((i) => i.id === item.id)!.archivedAt = new Date();
      await expectCode(service.remove(writer, item.id, photo.id), 'archived');
    });
  });
});
