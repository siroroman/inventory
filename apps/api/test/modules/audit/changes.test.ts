import { describe, expect, it } from 'vitest';
import { changedFields, initialFields } from '../../../src/modules/audit/changes.ts';

type Row = { name: string; note: string | null; parentId: string | null; version: number };

describe('audit change sets', () => {
  const before: Row = { name: 'Sklad', note: null, parentId: 'a', version: 1 };

  it('list only the fields that changed', () => {
    const after: Row = { name: 'Sklad B', note: null, parentId: null, version: 2 };
    expect(changedFields(before, after, ['name', 'note', 'parentId'])).toEqual({
      name: { from: 'Sklad', to: 'Sklad B' },
      parentId: { from: 'a', to: null },
    });
  });

  it('are empty when nothing changed', () => {
    expect(changedFields(before, { ...before, version: 2 }, ['name', 'note'])).toEqual({});
  });

  it('record the non-empty initial values of a new row', () => {
    expect(initialFields(before, ['name', 'note', 'parentId'])).toEqual({
      name: { from: null, to: 'Sklad' },
      parentId: { from: null, to: 'a' },
    });
  });
});
