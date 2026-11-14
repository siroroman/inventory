import { z } from 'zod';
import {
  codeRef,
  emailAddress,
  hasChange,
  humanCode,
  nullableText,
  pageOf,
  phoneNumber,
  recordFields,
  requiredText,
} from './fields.ts';
import { archivedQuery, searchPageQuery, versionField } from './http.ts';

/** Longest text each field of a contact takes; the location form checks the same limits. */
export const contactLimits = { role: 60, name: 120, phone: 30, email: 254 } as const;

/** The most contacts one location keeps. */
export const MAX_LOCATION_CONTACTS = 20;

/** Someone to reach for a location: "Správce", "Jan Novák", "+420 601 123 456". */
export const locationContactSchema = z.object({
  role: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type LocationContactDto = z.infer<typeof locationContactSchema>;

/** A contact as sent: a role and a phone or an email (or both); a missing name, phone or email is none. */
export const locationContactInput = z
  .strictObject({
    role: requiredText(contactLimits.role),
    name: nullableText(contactLimits.name),
    phone: phoneNumber.nullable(),
    email: emailAddress.nullable(),
  })
  .partial({ name: true, phone: true, email: true })
  .refine((contact) => Boolean(contact.phone || contact.email), {
    message: 'A phone or an email is required',
    path: ['phone'],
  });
export type LocationContactInput = z.infer<typeof locationContactInput>;

export const locationSchema = z.object({
  ...recordFields,
  code: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  /** Set on top-level locations only. */
  type: codeRef.nullable(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  /** From the top-level location down to this one, itself included. */
  path: z.array(codeRef),
  /**
   * Whether this location may be divided into sub-locations: the flag of the type of the top-level
   * location it sits under. The SPA shows sub-locations only where it is true (or some exist).
   */
  allowsSubLocations: z.boolean(),
  /** Active items in this location and everything below it. */
  itemCount: z.number().int().min(0),
  /** Active direct sub-locations. */
  childCount: z.number().int().min(0),
});
export type LocationDto = z.infer<typeof locationSchema>;

export const locationListSchema = pageOf(locationSchema);

/** The contacts of one location above the one shown. */
export const inheritedContactsSchema = z.object({ location: codeRef, contacts: z.array(locationContactSchema) });
export type InheritedContactsDto = z.infer<typeof inheritedContactsSchema>;

/** A location as its detail screen shows it: with its contacts and those of the locations above it. */
export const locationDetailSchema = locationSchema.extend({
  /** In the order they were entered. */
  contacts: z.array(locationContactSchema),
  /** The nearest location above first; only the ones that have contacts. */
  inheritedContacts: z.array(inheritedContactsSchema),
});
export type LocationDetailDto = z.infer<typeof locationDetailSchema>;

/** Longest text each field takes; the location form checks the same limits before sending. */
export const locationLimits = { name: 120, address: 200, note: 2000 } as const;

/** A location's human ID, chosen on creation and fixed afterwards. */
export const locationCode = humanCode;

const locationFields = {
  name: requiredText(locationLimits.name),
  /** Empty for a top-level location. */
  parentId: z.uuid().nullable(),
  /** Required for a top-level location, not allowed for a sub-location. */
  locationTypeId: z.uuid().nullable(),
  address: nullableText(locationLimits.address),
  note: nullableText(locationLimits.note),
  /** In the order to show them. */
  contacts: z.array(locationContactInput).max(MAX_LOCATION_CONTACTS),
};

const optionalLocationFields = { parentId: true, locationTypeId: true, address: true, note: true, contacts: true } as const;

/** `code` is optional: without it the database assigns the next LOC-nnn. */
export const createLocationBody = z
  .strictObject({ ...locationFields, code: locationCode })
  .partial({ code: true, ...optionalLocationFields });
export type CreateLocationBody = z.infer<typeof createLocationBody>;

/**
 * Only the fields present change; `null` clears one. Moving under a parent drops the type.
 * `contacts` replaces the whole list, `[]` clears it.
 */
export const updateLocationBody = z
  .strictObject({ ...locationFields, version: versionField })
  .partial({ name: true, ...optionalLocationFields })
  .refine(hasChange, { message: 'Nothing to change' });
export type UpdateLocationBody = z.infer<typeof updateLocationBody>;

/**
 * `?parentId=` lists that location's direct children. Without it the list is the top-level
 * locations, or, when `q` is given, every level (to pick a location for an item); such a search
 * with `withSubLocations=true` also lists everything below each match, ordered by path so the
 * sub-locations follow the one they are in. With `archived=true` it is the archived locations at
 * every level, narrowed by `parentId` and `q`.
 */
export const locationListQuery = searchPageQuery.extend({
  ...archivedQuery.shape,
  parentId: z.uuid().optional(),
  withSubLocations: z.literal('true').optional(),
});
