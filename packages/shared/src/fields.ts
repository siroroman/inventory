import { z } from 'zod';

// Building blocks for the entity schemas. Limits live here because the database has none: this is
// the only place that keeps a 10 MB note or a javascript: link out.

/** Required text: trimmed, so whitespace-only input is empty and rejected. */
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Optional text. `null` clears it; an empty string is rejected (the SPA sends `null` for an empty field). */
export const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

/** A calendar date without time, `2026-09-27`. */
export const isoDate = z.iso.date();

/** A moment in time as the API returns it, `2026-09-27T08:15:00.000Z`. */
export const timestamp = z.iso.datetime();

/**
 * Links to documents are limited to Google Drive and Docs, over https. The pattern is the one the
 * `items_documents_url_google` CHECK uses, so nothing passes here that the database then refuses
 * (no slash after the host, a port, user info, upper case).
 */
export const documentsUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\/(drive|docs)\.google\.com\//)
  .pipe(z.url({ protocol: /^https$/ }));

/** `?q=`: what the user typed in a search box. Blank input means no search, not an error. */
export const searchQuery = z
  .string()
  .trim()
  .max(100)
  .transform((q) => q || undefined);

/**
 * A human ID (the content of a QR label) chosen by the user on creation. Upper-cased so `sklad-a`
 * and `SKLAD-A` cannot both exist, and limited to characters that are safe in the `/q/<code>` URL.
 */
export const humanCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,29}$/);

/** A reference to a record by id, code and name, e.g. a location on a path or a location type. */
export const codeRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
export type CodeRef = z.infer<typeof codeRef>;

/** A PATCH body must change something: `version` alone would only bump the version and the audit log. */
export const hasChange = <T extends { version: number }>(body: T) =>
  Object.values(body).filter((value) => value !== undefined).length > 1;

/** A list response: one page plus the total for the list heading. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable(), total: z.number().int().min(0) });

/** Fields every stored record carries, as the API returns them. */
export const recordFields = {
  id: z.uuid(),
  version: z.number().int().min(1),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

/** Body of `POST /{id}/archive` and `/restore`. */
export const versionBody = z.strictObject({ version: z.number().int().min(1) });
