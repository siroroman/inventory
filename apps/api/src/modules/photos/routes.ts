import {
  confirmPhotoBody,
  idParam,
  photoListSchema,
  photoParams,
  photoSchema,
  reorderPhotosBody,
  requestUploadBody,
  uploadTargetSchema,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toPhotoDto } from './dto.ts';
import type { PhotoService } from './service.ts';

const requestUpload = defineRoute({
  method: 'post',
  path: '/items/{id}/photos/upload-url',
  minRole: 'write',
  tags: ['photos'],
  summary: 'Step 1 of adding a photo: a signed URL to PUT one JPEG, PNG or WebP file of up to 10 MB to',
  request: { params: idParam, body: { required: true, content: jsonContent(requestUploadBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'Where to upload, and the key to confirm with', content: jsonContent(uploadTargetSchema) } },
});

const confirm = defineRoute({
  method: 'post',
  path: '/items/{id}/photos',
  minRole: 'write',
  tags: ['photos'],
  summary: 'Step 2 of adding a photo: record the uploaded file at the end of the gallery',
  request: { params: idParam, body: { required: true, content: jsonContent(confirmPhotoBody) } },
  errors: [404, 409, 422],
  responses: { 201: { description: 'The new photo', content: jsonContent(photoSchema) } },
});

const reorder = defineRoute({
  method: 'patch',
  path: '/items/{id}/photos/order',
  minRole: 'write',
  tags: ['photos'],
  summary: 'Set the gallery order by sending every photo id of the item; the first is the main photo',
  request: { params: idParam, body: { required: true, content: jsonContent(reorderPhotosBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'The gallery in its new order', content: jsonContent(photoListSchema) } },
});

const remove = defineRoute({
  method: 'delete',
  path: '/items/{id}/photos/{photoId}',
  minRole: 'write',
  tags: ['photos'],
  summary: 'Remove a photo and its stored file; photos are the one thing that is deleted, not archived',
  request: { params: photoParams },
  errors: [404, 409],
  responses: { 204: { description: 'The photo is gone' } },
});

/** Photo galleries of items. Mounted under /api/v1; the gallery itself is read with `GET /items/{id}`. */
export function createPhotoRoutes(photos: PhotoService) {
  return createRouter()
    .openapi(requestUpload, async (c) => {
      const target = await photos.requestUpload(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(target, 200);
    })
    .openapi(confirm, async (c) => {
      const photo = await photos.confirm(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toPhotoDto(photo), 201);
    })
    .openapi(reorder, async (c) => {
      const list = await photos.reorder(c.get('actor'), c.req.valid('param').id, c.req.valid('json').photoIds);
      return c.json(list.map(toPhotoDto), 200);
    })
    .openapi(remove, async (c) => {
      const { id, photoId } = c.req.valid('param');
      await photos.remove(c.get('actor'), id, photoId);
      return c.body(null, 204);
    });
}
