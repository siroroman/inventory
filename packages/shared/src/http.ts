import { z } from 'zod';
import { errorCodes } from './errors.ts';

/** RFC 9457 problem details plus the machine-readable `code` the SPA translates. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(errorCodes),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  /** Code-specific data, e.g. the fields that failed validation. */
  details: z.record(z.string(), z.unknown()).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const idParam = z.object({ id: z.uuid() });

/** `?limit=50&cursor=`; the cursor is opaque and only valid for the list that issued it. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/** Optimistic locking: updates send the version they were based on; a stale one returns 409. */
export const versionField = z.number().int().min(1);
