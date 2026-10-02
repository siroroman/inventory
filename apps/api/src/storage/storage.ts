export type StoredObject = { size: number; contentType: string };

/**
 * The private bucket, seen from the services. The Cloud Storage adapter implements it;
 * tests use an in-memory fake. Browsers upload and download through the signed URLs, so files
 * never pass through the API. What may be uploaded (types, sizes) is each module's rule.
 */
export type ObjectStorage = {
  /** A URL the browser can PUT one file to, limited to this key, type and size. */
  createUploadUrl(key: string, contentType: string, maxBytes: number): Promise<string>;
  /**
   * A read URL. `fileName` makes the browser show the file under that name; `download` makes it
   * save the file instead of opening it (the default opens PDFs and pictures in the browser).
   */
  createReadUrl(key: string, ttlSeconds: number, options?: { fileName?: string; download?: boolean }): Promise<string>;
  /** Size and type of an uploaded object, or null when nothing was uploaded under the key. */
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};
