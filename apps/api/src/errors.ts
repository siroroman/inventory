import type { DomainErrorCode } from '@inventory/shared';

/** Codes a service can throw. The full list, with the HTTP-layer codes, lives in `@inventory/shared`. */
export type ErrorCode = DomainErrorCode;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  // No parameter properties: Node runs the TypeScript sources directly and only strips types.
  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
