import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../src/modules/audit/repository.ts';
import type { Photo, PhotoRepository } from '../../src/modules/photos/repository.ts';
import type { PhotoRepos } from '../../src/modules/photos/service.ts';
import { createFakeAuditRepository } from './audit.ts';
import { fakeTransact } from './common.ts';
import { createFakeItemStore } from './items.ts';

/** Photos on top of the item fake, which stays reachable for test setup. */
export function createFakePhotoStore() {
  const itemStore = createFakeItemStore();
  const state = { photos: [] as Photo[], audit: [] as AuditEntry[] };

  const ordered = (itemId: string) =>
    state.photos.filter((p) => p.itemId === itemId).sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1));

  const photos: PhotoRepository = {
    async list(itemId) {
      return ordered(itemId).map((p) => ({ ...p }));
    },
    async count(itemId) {
      return ordered(itemId).length;
    },
    async insert(values) {
      if (state.photos.some((p) => p.storageKey === values.storageKey)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'item_photos_storage_key_key' });
      }
      const row: Photo = {
        id: randomUUID(),
        itemId: values.itemId,
        storageKey: values.storageKey,
        contentType: values.contentType,
        width: values.width,
        height: values.height,
        sortOrder: Math.max(0, ...ordered(values.itemId).map((p) => p.sortOrder)) + 1,
        createdAt: new Date(),
        createdBy: values.createdBy,
      };
      state.photos.push(row);
      return { ...row };
    },
    async delete(itemId, photoId) {
      const index = state.photos.findIndex((p) => p.id === photoId && p.itemId === itemId);
      return index < 0 ? undefined : state.photos.splice(index, 1)[0];
    },
    async reorder(itemId, orderedIds) {
      let updated = 0;
      orderedIds.forEach((id, index) => {
        const row = state.photos.find((p) => p.id === id && p.itemId === itemId);
        if (row) {
          row.sortOrder = index + 1;
          updated++;
        }
      });
      return updated;
    },
  };

  const repos: PhotoRepos = { photos, items: itemStore.repos.items, audit: createFakeAuditRepository(state.audit) };

  const snapshot = () => {
    const copy = structuredClone(state);
    const restoreItems = itemStore.snapshot();
    return () => {
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        state[key].splice(0, state[key].length, ...(copy[key] as never[]));
      }
      restoreItems();
    };
  };

  return {
    state,
    repos,
    transact: fakeTransact(repos, { snapshot }),
    itemStore,
    /** Test setup shortcut: an active item in a fresh location. */
    addItem: async (name = 'Konvektomat') => {
      const location = await itemStore.addLocation(`Sklad ${randomUUID().slice(0, 4)}`);
      return itemStore.repos.items.insert({ name, locationId: location.id, createdBy: 'setup' });
    },
  };
}
