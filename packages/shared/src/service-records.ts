import { z } from 'zod';
import { codeRef, hasChange, isoDate, nullableText, pageOf, recordFields, requiredText } from './fields.ts';
import { archivedQuery, pageQuery, searchPageQuery, versionField } from './http.ts';

const recordContent = {
  performedOn: isoDate,
  title: requiredText(200),
  /** Who did the service: free text (a company or a person), not a link to a registered provider. */
  performedBy: nullableText(200),
  responsiblePerson: nullableText(120),
  description: nullableText(4000),
};

/** A row of an item's service history. */
export const serviceRecordSummarySchema = z.object({
  id: z.uuid(),
  performedOn: recordContent.performedOn,
  title: recordContent.title,
});
export type ServiceRecordSummaryDto = z.infer<typeof serviceRecordSummarySchema>;

export const serviceRecordListSchema = pageOf(serviceRecordSummarySchema);

/** A row of the list of all service records: the record, its item and the item's location path (empty without one). */
export const serviceRecordListEntrySchema = z.object({
  ...recordFields,
  performedOn: recordContent.performedOn,
  title: recordContent.title,
  item: codeRef,
  location: codeRef.nullable(),
  path: z.array(codeRef),
});
export type ServiceRecordListEntryDto = z.infer<typeof serviceRecordListEntrySchema>;

export const serviceRecordSearchListSchema = pageOf(serviceRecordListEntrySchema);

/** `q` covers the title, the item's name and ID and the location names; `archived` lists the archived records instead. */
export const serviceRecordSearchQuery = searchPageQuery.extend(archivedQuery.shape);

/** The item a record belongs to; `archivedAt` tells the SPA to hide the buttons that change the record. */
export const serviceRecordItemSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  archivedAt: recordFields.archivedAt,
});

export const serviceRecordSchema = z.object({
  ...recordFields,
  ...recordContent,
  item: serviceRecordItemSchema,
});
export type ServiceRecordDto = z.infer<typeof serviceRecordSchema>;

const optionalFields = { performedBy: true, responsiblePerson: true, description: true } as const;

export const createServiceRecordBody = z.strictObject(recordContent).partial(optionalFields);
export type CreateServiceRecordBody = z.infer<typeof createServiceRecordBody>;

/** Only the fields present change; `null` clears the optional ones. */
export const updateServiceRecordBody = z
  .strictObject({ ...recordContent, version: versionField })
  .partial({ performedOn: true, title: true, ...optionalFields })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateServiceRecordBody = z.infer<typeof updateServiceRecordBody>;

export const serviceRecordListQuery = pageQuery;
