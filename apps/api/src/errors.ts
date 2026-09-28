/**
 * Machine-readable error codes. Services throw them without knowing HTTP; routes map each code to
 * a status and a problem+json body, and the SPA maps it to Czech text.
 */
export type ErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'archived'
  | 'not_archived'
  | 'parent_not_found'
  | 'parent_archived'
  | 'location_cycle'
  | 'location_type_required'
  | 'location_type_not_allowed'
  | 'location_type_not_found';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
