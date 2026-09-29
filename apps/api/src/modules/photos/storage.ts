/** Formats the database accepts (item_photos_content_type_image); the SPA converts before upload. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Read URLs in API responses stay valid this long. */
export const PHOTO_URL_TTL_SECONDS = 15 * 60;

export type StoredObject = { size: number; contentType: string };

/**
 * The private bucket, seen from the services. The Cloud Storage adapter implements it later;
 * tests use an in-memory fake. Browsers upload and download through the signed URLs, so files
 * never pass through the API.
 */
export type PhotoStorage = {
  /** A URL the browser can PUT one file to, limited to this key, type and size. */
  createUploadUrl(key: string, contentType: PhotoContentType, maxBytes: number): Promise<string>;
  createReadUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Size and type of an uploaded object, or null when nothing was uploaded under the key. */
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};
