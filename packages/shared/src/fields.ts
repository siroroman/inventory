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

/** Links to documents are limited to Google Drive and Docs, over https. */
export const documentsUrl = z
  .url({ protocol: /^https$/, hostname: /^(drive|docs)\.google\.com$/ })
  .max(2048);

/** `?q=`: what the user typed in a search box. */
export const searchQuery = z.string().trim().min(1).max(100);

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
