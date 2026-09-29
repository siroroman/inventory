import { describe, expect, it } from 'vitest';
import { domainErrorCodes, errorCodes, httpErrorCodes, idParam, pageQuery, problemSchema, versionField } from '../src/index.ts';

describe('error codes', () => {
  it('has no duplicates across the domain and HTTP lists', () => {
    expect(new Set(errorCodes).size).toBe(domainErrorCodes.length + httpErrorCodes.length);
  });

  it('uses snake_case', () => {
    for (const code of errorCodes) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe('problemSchema', () => {
  const base = { type: 'about:blank', title: 'Conflict', status: 409 };

  it('accepts a problem with a known code', () => {
    expect(problemSchema.parse({ ...base, code: 'conflict' }).code).toBe('conflict');
  });

  it('rejects an unknown code', () => {
    expect(problemSchema.safeParse({ ...base, code: 'nope' }).success).toBe(false);
  });
});

describe('pageQuery', () => {
  it('defaults the limit to 50', () => {
    expect(pageQuery.parse({})).toEqual({ limit: 50 });
  });

  it('coerces the limit from the query string', () => {
    expect(pageQuery.parse({ limit: '20', cursor: 'abc' })).toEqual({ limit: 20, cursor: 'abc' });
  });

  it.each(['0', '101', '1.5', 'x'])('rejects limit %s', (limit) => {
    expect(pageQuery.safeParse({ limit }).success).toBe(false);
  });

  it('rejects an empty cursor', () => {
    expect(pageQuery.safeParse({ cursor: '' }).success).toBe(false);
  });
});

describe('idParam and versionField', () => {
  it('requires a UUID id', () => {
    expect(idParam.safeParse({ id: 'nope' }).success).toBe(false);
    expect(idParam.safeParse({ id: '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40' }).success).toBe(true);
  });

  it('requires a positive integer version', () => {
    expect(versionField.safeParse(1).success).toBe(true);
    expect(versionField.safeParse(0).success).toBe(false);
    expect(versionField.safeParse(1.5).success).toBe(false);
  });
});
