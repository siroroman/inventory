import { generateKeyPairSync } from 'node:crypto';
import { type Bucket, Storage } from '@google-cloud/storage';
import type { ObjectStorage } from './storage.ts';

/** How long a signed upload link works: long enough for a slow phone connection. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** The part of a Cloud Storage file this adapter uses; a test double stands in for it. */
export type StorageFile = {
  getSignedUrl(config: {
    version: 'v4';
    action: 'read' | 'write';
    expires: number;
    contentType?: string;
    extensionHeaders?: Record<string, string>;
    responseDisposition?: string;
  }): Promise<[string]>;
  getMetadata(): Promise<[{ size?: string | number; contentType?: string }, ...unknown[]]>;
  delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
};
export type StorageBucket = { file(name: string): StorageFile };

/** `inline; filename*=UTF-8''...`: the browser opens the file and keeps a readable name for saving. */
export const contentDisposition = (fileName: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

const isNotFound = (error: unknown) => (error as { code?: number } | null)?.code === 404;

/**
 * The private bucket on Cloud Storage. Browsers upload and download through V4 signed URLs;
 * the upload URL signs the content type and a size range, so the bucket itself refuses a
 * different type or a bigger file than the service asked for.
 */
export function createCloudStorage(bucket: StorageBucket, now: () => number = Date.now): ObjectStorage {
  const expiry = (ttlSeconds: number) => now() + ttlSeconds * 1000;
  return {
    async createUploadUrl(key, contentType, maxBytes) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiry(UPLOAD_URL_TTL_SECONDS),
        contentType,
        extensionHeaders: { 'x-goog-content-length-range': `0,${maxBytes}` },
      });
      return url;
    },
    async createReadUrl(key, ttlSeconds, options) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiry(ttlSeconds),
        responseDisposition: options?.fileName ? contentDisposition(options.fileName) : undefined,
      });
      return url;
    },
    async head(key) {
      try {
        const [metadata] = await bucket.file(key).getMetadata();
        return { size: Number(metadata.size ?? 0), contentType: metadata.contentType ?? '' };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}

/**
 * Opens the bucket. On Cloud Run it signs through the runtime service account (IAM signBlob), so no
 * key file exists. With `apiEndpoint` (the local emulator, which ignores signatures) it signs with
 * a throwaway key made at startup and talks to the emulator without credentials.
 */
export function openBucket({ name, apiEndpoint }: { name: string; apiEndpoint?: string }): Bucket {
  if (!apiEndpoint) return new Storage().bucket(name);
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return new Storage({
    apiEndpoint,
    projectId: 'local',
    credentials: { client_email: 'emulator@local.test', private_key: privateKey },
  }).bucket(name);
}
