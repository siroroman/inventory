import { expect } from 'vitest';
import { DomainError, type ErrorCode } from '../../src/errors.ts';

export async function expectCode(action: Promise<unknown>, code: ErrorCode) {
  await expect(action).rejects.toThrow(DomainError);
  await expect(action).rejects.toMatchObject({ code });
}
