import { type Actor, assertRole } from '../../auth/roles.ts';
import type { DbExecutor } from '../../db/client.ts';
import type { Transact } from '../../db/transaction.ts';
import { DomainError } from '../../errors.ts';
import { type AuditRepository, createAuditRepository } from '../audit/repository.ts';
import { createItemRepository, type ItemRepository } from '../items/repository.ts';
import { createPhotoRepository, type Photo, type PhotoRepository } from './repository.ts';
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  PHOTO_URL_TTL_SECONDS,
  type PhotoContentType,
  type PhotoStorage,
} from './storage.ts';

export type PhotoRepos = {
  photos: PhotoRepository;
  /** Read-only here: photos belong to an existing, active item. */
  items: ItemRepository;
  audit: AuditRepository;
};

export const photoRepos = (db: DbExecutor): PhotoRepos => ({
  photos: createPhotoRepository(db),
  items: createItemRepository(db),
  audit: createAuditRepository(db),
});

export type PhotoDeps = {
  repos: PhotoRepos;
  transact: Transact<PhotoRepos>;
  storage: PhotoStorage;
  /** Unique part of a new storage key (a UUID in production), injected to keep tests deterministic. */
  newId: () => string;
};

export type PhotoWithUrl = Photo & { url: string };

export type UploadTarget = { key: string; uploadUrl: string };
export type ConfirmPhotoInput = { key: string; width: number; height: number };

const EXTENSIONS: Record<PhotoContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const isPhotoType = (type: string): type is PhotoContentType => (PHOTO_CONTENT_TYPES as readonly string[]).includes(type);
const keyPattern = (itemId: string) => new RegExp(`^items/${itemId}/[A-Za-z0-9-]+\\.(jpg|png|webp)$`);

async function loadActiveItem(r: PhotoRepos, itemId: string): Promise<void> {
  const item = await r.items.findById(itemId);
  if (!item) throw new DomainError('not_found');
  if (item.archivedAt) throw new DomainError('archived');
}

/**
 * Photo galleries of items. Adding a photo takes two steps: `requestUpload` hands out a signed
 * URL, the browser uploads the file, then `confirm` records it once the file is really there.
 */
export function createPhotoService({ repos, transact, storage, newId }: PhotoDeps) {
  const withUrl = async (photo: Photo): Promise<PhotoWithUrl> => ({
    ...photo,
    url: await storage.createReadUrl(photo.storageKey, PHOTO_URL_TTL_SECONDS),
  });

  return {
    /** Gallery order, each photo with a read URL valid for 15 minutes. Archived items included. */
    async list(actor: Actor, itemId: string): Promise<PhotoWithUrl[]> {
      assertRole(actor, 'read');
      if (!(await repos.items.findById(itemId))) throw new DomainError('not_found');
      return Promise.all((await repos.photos.list(itemId)).map(withUrl));
    },

    async requestUpload(actor: Actor, itemId: string, input: { contentType: string }): Promise<UploadTarget> {
      assertRole(actor, 'write');
      await loadActiveItem(repos, itemId);
      if (!isPhotoType(input.contentType)) throw new DomainError('photo_type_not_allowed');
      const key = `items/${itemId}/${newId()}.${EXTENSIONS[input.contentType]}`;
      return { key, uploadUrl: await storage.createUploadUrl(key, input.contentType, MAX_PHOTO_BYTES) };
    },

    /** Records an uploaded photo at the end of the gallery. The stored file is checked, not the client's word. */
    async confirm(actor: Actor, itemId: string, input: ConfirmPhotoInput): Promise<PhotoWithUrl> {
      assertRole(actor, 'write');
      const row = await transact(async (r) => {
        await loadActiveItem(r, itemId);
        if (!keyPattern(itemId).test(input.key)) throw new DomainError('invalid_photo_key');
        const stored = await storage.head(input.key);
        if (!stored) throw new DomainError('photo_not_uploaded');
        if (stored.size > MAX_PHOTO_BYTES) throw new DomainError('photo_too_large');
        if (!isPhotoType(stored.contentType)) throw new DomainError('photo_type_not_allowed');

        const row = await r.photos.insert({
          itemId,
          storageKey: input.key,
          contentType: stored.contentType,
          width: input.width,
          height: input.height,
          createdBy: actor.id,
        });
        await r.audit.record({
          userId: actor.id,
          entityType: 'photo',
          entityId: row.id,
          action: 'create',
          changes: {
            itemId: { from: null, to: itemId },
            storageKey: { from: null, to: row.storageKey },
            contentType: { from: null, to: row.contentType },
          },
        });
        return row;
      });
      return withUrl(row);
    },

    /** `orderedIds` must be exactly this item's photos; the first becomes the main photo. */
    async reorder(actor: Actor, itemId: string, orderedIds: string[]): Promise<PhotoWithUrl[]> {
      assertRole(actor, 'write');
      const photos = await transact(async (r) => {
        await loadActiveItem(r, itemId);
        const current = (await r.photos.list(itemId)).map((p) => p.id);
        const sameSet = orderedIds.length === current.length && new Set(orderedIds).size === current.length && orderedIds.every((id) => current.includes(id));
        if (!sameSet) throw new DomainError('invalid_photo_order');
        if (orderedIds.join() !== current.join()) {
          await r.photos.reorder(itemId, orderedIds);
          await r.audit.record({
            userId: actor.id,
            entityType: 'item',
            entityId: itemId,
            action: 'update',
            changes: { photoOrder: { from: current, to: orderedIds } },
          });
        }
        return r.photos.list(itemId);
      });
      return Promise.all(photos.map(withUrl));
    },

    /** Deletes the row, then the stored file. A failed file delete only leaves an orphan behind. */
    async remove(actor: Actor, itemId: string, photoId: string): Promise<void> {
      assertRole(actor, 'write');
      const removed = await transact(async (r) => {
        await loadActiveItem(r, itemId);
        const row = await r.photos.delete(itemId, photoId);
        if (!row) throw new DomainError('not_found');
        await r.audit.record({
          userId: actor.id,
          entityType: 'photo',
          entityId: photoId,
          action: 'delete',
          changes: { itemId: { from: itemId, to: null }, storageKey: { from: row.storageKey, to: null } },
        });
        return row;
      });
      try {
        await storage.delete(removed.storageKey);
      } catch {
        // The database is the truth; the bucket keeps deleted files recoverable anyway.
      }
    },
  };
}

export type PhotoService = ReturnType<typeof createPhotoService>;
