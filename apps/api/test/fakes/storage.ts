import type { ObjectStorage, StoredObject } from '../../src/storage/storage.ts';

/** In-memory bucket. `upload` plays the browser's PUT to a signed upload URL. */
export function createFakeStorage() {
  const objects = new Map<string, StoredObject>();
  const deleted: string[] = [];
  const uploadUrls: { key: string; contentType: string; maxBytes: number }[] = [];
  const state = { failDelete: false };

  const storage: ObjectStorage = {
    async createUploadUrl(key, contentType, maxBytes) {
      uploadUrls.push({ key, contentType, maxBytes });
      return `https://storage.test/upload/${key}`;
    },
    async createReadUrl(key, ttlSeconds, options) {
      const name = options?.fileName ? `&name=${encodeURIComponent(options.fileName)}` : '';
      return `https://storage.test/${key}?ttl=${ttlSeconds}${name}`;
    },
    async head(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      if (state.failDelete) throw new Error('storage unavailable');
      objects.delete(key);
      deleted.push(key);
    },
  };

  return {
    storage,
    objects,
    deleted,
    uploadUrls,
    state,
    upload: (key: string, object: Partial<StoredObject> = {}) =>
      objects.set(key, { size: 200_000, contentType: 'image/jpeg', ...object }),
  };
}
