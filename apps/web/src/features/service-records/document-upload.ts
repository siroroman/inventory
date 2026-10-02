import { type DocumentDto, MAX_DOCUMENT_BYTES } from '@inventory/shared';
import { ApiError, api, unwrap } from '@/lib/api';
import { resizeImage } from '@/lib/resize-image';
import { classifyFile } from './document-files';

/** The file as it will be uploaded: a picture shrunk to a JPEG, anything else as it is. */
async function prepare(file: File): Promise<{ body: Blob; contentType: string }> {
  const kind = classifyFile(file);
  if (!kind) throw new ApiError('document_type_not_allowed', 0);
  if (kind.kind === 'file') return { body: file, contentType: kind.contentType };
  try {
    return { body: await resizeImage(file), contentType: 'image/jpeg' };
  } catch {
    throw new ApiError('file_unreadable', 0);
  }
}

/**
 * Attaches one file to a service record in the three calls the API wants: ask for a signed URL,
 * PUT the file straight to the bucket, confirm it under `name`. The bucket is not the API, so
 * its answer is only an HTTP status.
 */
export async function uploadDocument(recordId: string, file: File, name: string): Promise<DocumentDto> {
  const { body, contentType } = await prepare(file);
  if (body.size > MAX_DOCUMENT_BYTES) throw new ApiError('document_too_large', 0);

  const param = { id: recordId };
  const target = await unwrap(
    api.api.v1['service-records'][':id'].documents['upload-url'].$post({ param, json: { contentType, size: body.size } }),
  );

  let response: Response;
  try {
    response = await fetch(target.uploadUrl, {
      method: 'PUT',
      // Both headers are part of the signature: the bucket refuses anything else.
      headers: { 'Content-Type': contentType, 'x-goog-content-length-range': `0,${body.size}` },
      body,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!response.ok) throw new ApiError('upload_failed', response.status);

  return unwrap(api.api.v1['service-records'][':id'].documents.$post({ param, json: { key: target.key, name } }));
}
