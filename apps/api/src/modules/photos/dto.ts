import type { PhotoDto } from '@inventory/shared';
import type { PhotoWithUrl } from './service.ts';

/** The storage key stays inside the API; the browser only ever sees the signed URL. */
export function toPhotoDto(photo: PhotoWithUrl): PhotoDto {
  return { id: photo.id, url: photo.url, contentType: photo.contentType, width: photo.width, height: photo.height };
}
