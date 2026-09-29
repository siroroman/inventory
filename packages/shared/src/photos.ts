import { z } from 'zod';
import { itemSchema } from './items.ts';

/** A photo of an item as the API returns it; `url` is a read link that expires after 15 minutes. */
export const photoSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  contentType: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type PhotoDto = z.infer<typeof photoSchema>;

/** The whole gallery; the first photo is the main one. */
export const photoListSchema = z.array(photoSchema);

/**
 * The item with its gallery. Only `GET /items/{id}` returns it; the item's writes answer with the
 * item alone, and the SPA reloads the detail after them.
 */
export const itemDetailSchema = itemSchema.extend({ photos: photoListSchema });
export type ItemDetailDto = z.infer<typeof itemDetailSchema>;

/**
 * Step one of adding a photo. The type is checked by the service, not here, so a GIF gets the
 * `photo_type_not_allowed` code the SPA has a message for rather than a generic validation error.
 */
export const requestUploadBody = z.strictObject({ contentType: z.string().trim().min(1).max(100) });

/** Where the browser PUTs the file, and the key it sends back to confirm the upload. */
export const uploadTargetSchema = z.object({ key: z.string(), uploadUrl: z.string() });
export type UploadTargetDto = z.infer<typeof uploadTargetSchema>;

/** Step two: the file is uploaded. The size and type are read from the stored file; the dimensions are the browser's word. */
export const confirmPhotoBody = z.strictObject({
  key: z.string().min(1).max(200),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
});
export type ConfirmPhotoBody = z.infer<typeof confirmPhotoBody>;

/** Every photo id of the item, in the new order; the first becomes the main photo. */
export const reorderPhotosBody = z.strictObject({ photoIds: z.array(z.uuid()) });
export type ReorderPhotosBody = z.infer<typeof reorderPhotosBody>;

export const photoParams = z.object({ id: z.uuid(), photoId: z.uuid() });
