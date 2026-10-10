/**
 * Machine-readable error codes. Services throw the domain ones without knowing HTTP; the API maps
 * each code to a status and a problem+json body, and the SPA maps it to Czech text.
 */
export const domainErrorCodes = [
  'forbidden',
  'not_found',
  'conflict',
  'archived',
  'not_archived',
  'parent_not_found',
  'parent_archived',
  'location_cycle',
  'location_type_required',
  'location_type_not_allowed',
  'location_type_not_found',
  'duplicate_location_type',
  'duplicate_location_code',
  'duplicate_item_code',
  'duplicate_provider',
  'provider_not_found',
  'provider_archived',
  'duplicate_manufacturer',
  'manufacturer_not_found',
  'manufacturer_archived',
  'location_not_found',
  'location_archived',
  'duplicate_external_id',
  'invalid_photo_key',
  'photo_not_uploaded',
  'photo_too_large',
  'photo_type_not_allowed',
  'invalid_photo_order',
  'invalid_document_key',
  'document_not_uploaded',
  'document_too_large',
  'document_type_not_allowed',
  'inventory_overlap',
  'inventory_closed',
  'inventory_in_progress',
  'inventory_not_finished',
  'item_not_in_inventory',
  'location_outside_inventory',
  'email_taken',
  'cannot_modify_self',
  'last_admin',
] as const;

/** Raised by the HTTP layer itself, before or around a service call. */
export const httpErrorCodes = [
  'unauthenticated',
  'validation_error',
  'invalid_cursor',
  'payload_too_large',
  'rate_limited',
  'internal_error',
] as const;

export const errorCodes = [...domainErrorCodes, ...httpErrorCodes] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];
export type HttpErrorCode = (typeof httpErrorCodes)[number];
export type ErrorCode = DomainErrorCode | HttpErrorCode;
