import { describe, expect, it } from 'vitest';
import { csvRecords, parseCsv } from '../../src/db/import/csv.ts';

describe('parseCsv', () => {
  it('splits plain fields and lines, with or without a final line break', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps commas, line breaks and doubled quotes inside quoted fields', () => {
    expect(parseCsv('name,note\n"Váha, 2 ks","řádek 1\nřádek 2"\n"Rám ""A1""",\n')).toEqual([
      ['name', 'note'],
      ['Váha, 2 ks', 'řádek 1\nřádek 2'],
      ['Rám "A1"', ''],
    ]);
  });

  it('ignores a byte order mark and keeps empty fields', () => {
    expect(parseCsv('﻿a,b,c\n,,x\n')).toEqual([['a', 'b', 'c'], ['', '', 'x']]);
  });

  it('refuses a quote that is never closed', () => {
    expect(() => parseCsv('a\n"open\n')).toThrow('quoted field');
  });
});

describe('csvRecords', () => {
  it('keys the fields by the header', () => {
    expect(csvRecords('id,name\n50,Anděl\n', ['id', 'name'])).toEqual([{ id: '50', name: 'Anděl' }]);
  });

  it('names missing columns and a record with the wrong number of fields', () => {
    expect(() => csvRecords('id\n50\n', ['id', 'name'])).toThrow('lacks the columns name');
    expect(() => csvRecords('id,name\n50\n', ['id', 'name'])).toThrow('record 1 has 1 fields');
  });
});
