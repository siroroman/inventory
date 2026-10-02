/** Formats the database accepts (item_photos_content_type_image); the SPA converts before upload. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Read URLs in API responses stay valid this long. */
export const PHOTO_URL_TTL_SECONDS = 15 * 60;
