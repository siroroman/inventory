import { describe, expect, it } from 'vitest';
import { createServiceRecordBody, serviceRecordListQuery, updateServiceRecordBody } from '../src/index.ts';

describe('createServiceRecordBody', () => {
  it('needs a date and a title; the rest is optional', () => {
    expect(createServiceRecordBody.parse({ performedOn: '2026-04-15', title: ' Výměna filtru ' })).toEqual({
      performedOn: '2026-04-15',
      title: 'Výměna filtru',
    });
    expect(
      createServiceRecordBody.parse({
        performedOn: '2026-04-15',
        title: 'Výměna filtru',
        performedBy: ' Servis Novák s.r.o. ',
        responsiblePerson: 'Jan Novák',
        description: null,
      }),
    ).toMatchObject({ performedBy: 'Servis Novák s.r.o.', responsiblePerson: 'Jan Novák', description: null });
  });

  it('rejects a missing or blank title, a bad date, empty text, too long text and unknown keys', () => {
    const ok = { performedOn: '2026-04-15', title: 'x' };
    for (const body of [
      {},
      { performedOn: '2026-04-15' },
      { title: 'x' },
      { ...ok, title: '  ' },
      { ...ok, title: 'x'.repeat(201) },
      { ...ok, performedOn: '2026-02-31' },
      { ...ok, performedOn: '15. 4. 2026' },
      { ...ok, performedOn: '2026-04-15T10:00:00Z' },
      { ...ok, performedBy: '' },
      { ...ok, performedBy: 'x'.repeat(201) },
      { ...ok, responsiblePerson: 'x'.repeat(121) },
      { ...ok, description: 'x'.repeat(4001) },
      { ...ok, itemId: '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40' },
    ]) {
      expect(createServiceRecordBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('updateServiceRecordBody', () => {
  it('takes any subset of fields with the version, and null clears the optional ones', () => {
    expect(updateServiceRecordBody.parse({ version: 3, title: 'Nový název' })).toEqual({ version: 3, title: 'Nový název' });
    expect(
      updateServiceRecordBody.parse({ version: 3, performedBy: null, responsiblePerson: null, description: null }),
    ).toEqual({ version: 3, performedBy: null, responsiblePerson: null, description: null });
  });

  it('rejects a missing version, a body with nothing to change, and a cleared title or date', () => {
    for (const body of [
      { title: 'x' },
      { version: 0, title: 'x' },
      { version: 1 },
      { version: 1, title: null },
      { version: 1, title: ' ' },
      { version: 1, performedOn: null },
      { version: 1, itemId: '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40' },
    ]) {
      expect(updateServiceRecordBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('serviceRecordListQuery', () => {
  it('pages like the other lists', () => {
    expect(serviceRecordListQuery.parse({})).toEqual({ limit: 50 });
    expect(serviceRecordListQuery.parse({ limit: '20', cursor: 'abc' })).toEqual({ limit: 20, cursor: 'abc' });
    expect(serviceRecordListQuery.safeParse({ limit: '0' }).success).toBe(false);
  });
});
