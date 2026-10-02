import {
  confirmDocumentBody,
  documentListSchema,
  documentParams,
  documentSchema,
  idParam,
  renameDocumentBody,
  requestDocumentUploadBody,
  uploadTargetSchema,
} from '@inventory/shared';
import { defineRoute, jsonContent } from '../../http/route.ts';
import { createRouter } from '../../http/router.ts';
import { toDocumentDto } from './dto.ts';
import type { RecordDocumentService } from './service.ts';

const list = defineRoute({
  method: 'get',
  path: '/service-records/{id}/documents',
  minRole: 'read',
  tags: ['service-record-documents'],
  summary: 'Documents of a service record, newest first, each with a read URL valid for 15 minutes',
  request: { params: idParam },
  errors: [404],
  responses: { 200: { description: 'The documents', content: jsonContent(documentListSchema) } },
});

const requestUpload = defineRoute({
  method: 'post',
  path: '/service-records/{id}/documents/upload-url',
  minRole: 'write',
  tags: ['service-record-documents'],
  summary: 'Step 1 of adding a document: a signed URL to PUT one PDF, image, Word or Excel file of up to 20 MB to',
  request: { params: idParam, body: { required: true, content: jsonContent(requestDocumentUploadBody) } },
  errors: [404, 409, 422],
  responses: { 200: { description: 'Where to upload, and the key to confirm with', content: jsonContent(uploadTargetSchema) } },
});

const confirm = defineRoute({
  method: 'post',
  path: '/service-records/{id}/documents',
  minRole: 'write',
  tags: ['service-record-documents'],
  summary: 'Step 2 of adding a document: record the uploaded file under the given name',
  request: { params: idParam, body: { required: true, content: jsonContent(confirmDocumentBody) } },
  errors: [404, 409, 422],
  responses: { 201: { description: 'The new document', content: jsonContent(documentSchema) } },
});

const rename = defineRoute({
  method: 'patch',
  path: '/service-records/{id}/documents/{documentId}',
  minRole: 'write',
  tags: ['service-record-documents'],
  summary: 'Rename a document; a stale version returns 409',
  request: { params: documentParams, body: { required: true, content: jsonContent(renameDocumentBody) } },
  errors: [404, 409],
  responses: { 200: { description: 'The renamed document', content: jsonContent(documentSchema) } },
});

const remove = defineRoute({
  method: 'delete',
  path: '/service-records/{id}/documents/{documentId}',
  minRole: 'write',
  tags: ['service-record-documents'],
  summary: 'Remove a document and its stored file; documents are deleted, not archived',
  request: { params: documentParams },
  errors: [404, 409],
  responses: { 204: { description: 'The document is gone' } },
});

/** Documents of service records. Mounted under /api/v1. */
export function createRecordDocumentRoutes(documents: RecordDocumentService) {
  return createRouter()
    .openapi(list, async (c) => {
      const rows = await documents.list(c.get('actor'), c.req.valid('param').id);
      return c.json(rows.map(toDocumentDto), 200);
    })
    .openapi(requestUpload, async (c) => {
      const target = await documents.requestUpload(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(target, 200);
    })
    .openapi(confirm, async (c) => {
      const row = await documents.confirm(c.get('actor'), c.req.valid('param').id, c.req.valid('json'));
      return c.json(toDocumentDto(row), 201);
    })
    .openapi(rename, async (c) => {
      const { id, documentId } = c.req.valid('param');
      const row = await documents.rename(c.get('actor'), id, documentId, c.req.valid('json'));
      return c.json(toDocumentDto(row), 200);
    })
    .openapi(remove, async (c) => {
      const { id, documentId } = c.req.valid('param');
      await documents.remove(c.get('actor'), id, documentId);
      return c.body(null, 204);
    });
}
