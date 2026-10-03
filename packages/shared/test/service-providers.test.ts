import { describe, expect, it } from 'vitest';
import {
  createServiceProviderBody,
  serviceProviderListQuery,
  setManufacturersBody,
  updateServiceProviderBody,
} from '../src/index.ts';

const ID = '0b7f1d4e-7c1a-4d5e-9a3b-2f6c8e1d9a40';

describe('createServiceProviderBody', () => {
  it('needs only a name; the rest is optional', () => {
    expect(createServiceProviderBody.parse({ name: ' Servis Novák ' })).toEqual({ name: 'Servis Novák' });
    expect(
      createServiceProviderBody.parse({
        name: 'Servis Novák',
        contactPerson: 'Jan Novák',
        phone: '+420 111 222 333',
        email: ' novak@example.test ',
        web: 'https://novak.example.test/servis',
        note: null,
      }),
    ).toMatchObject({ email: 'novak@example.test', web: 'https://novak.example.test/servis', note: null });
  });

  it('accepts internationalised email addresses', () => {
    for (const email of ['servis@příklad.cz', 'jiří.novák@example.test']) {
      expect(createServiceProviderBody.safeParse({ name: 'x', email }).success, email).toBe(true);
    }
  });

  it('accepts plain http links, which small firms still use', () => {
    expect(createServiceProviderBody.safeParse({ name: 'x', web: 'http://novak.example.test' }).success).toBe(true);
  });

  it('rejects a blank name, bad contact data, empty text, too long text and unknown keys', () => {
    for (const body of [
      {},
      { name: '  ' },
      { name: 'x'.repeat(121) },
      { name: 'x', email: 'not-an-email' },
      { name: 'x', email: '' },
      { name: 'x', web: 'javascript:alert(1)' },
      { name: 'x', web: 'ftp://novak.example.test' },
      { name: 'x', web: 'novak.example.test' },
      { name: 'x', web: 'https://known-supplier.cz@elsewhere.test' },
      { name: 'x', web: 'https://user:secret@novak.example.test' },
      { name: 'x', web: '' },
      { name: 'x', phone: '' },
      { name: 'x', phone: '1'.repeat(41) },
      { name: 'x', contactPerson: 'j'.repeat(121) },
      { name: 'x', note: 'n'.repeat(2001) },
      { name: 'x', code: 'SUP-999' },
      { name: 'x', manufacturerIds: [] },
    ]) {
      expect(createServiceProviderBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('updateServiceProviderBody', () => {
  it('needs the version and at least one field; null clears one', () => {
    expect(updateServiceProviderBody.parse({ version: 2, phone: null })).toEqual({ version: 2, phone: null });
    expect(updateServiceProviderBody.safeParse({ version: 2 }).success).toBe(false);
    expect(updateServiceProviderBody.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateServiceProviderBody.safeParse({ version: 0, name: 'x' }).success).toBe(false);
  });

  it('cannot clear the name and applies the same checks as create', () => {
    for (const body of [
      { version: 1, name: null },
      { version: 1, name: ' ' },
      { version: 1, email: 'nope' },
      { version: 1, web: 'javascript:alert(1)' },
      { version: 1, code: 'SUP-999' },
    ]) {
      expect(updateServiceProviderBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('serviceProviderListQuery', () => {
  it('defaults the limit and ignores a blank search', () => {
    expect(serviceProviderListQuery.parse({})).toEqual({ limit: 50 });
    expect(serviceProviderListQuery.parse({ q: '  ' })).toEqual({ limit: 50, q: undefined });
    expect(serviceProviderListQuery.parse({ q: ' Novák ' })).toMatchObject({ q: 'Novák' });
  });

  it('accepts only archived=true', () => {
    expect(serviceProviderListQuery.parse({ archived: 'true' })).toMatchObject({ archived: 'true' });
    expect(serviceProviderListQuery.safeParse({ archived: 'false' }).success).toBe(false);
  });
});

describe('setManufacturersBody', () => {
  it('takes the version and a list of ids, empty included', () => {
    expect(setManufacturersBody.parse({ version: 3, manufacturerIds: [ID] })).toEqual({ version: 3, manufacturerIds: [ID] });
    expect(setManufacturersBody.parse({ version: 1, manufacturerIds: [] })).toEqual({ version: 1, manufacturerIds: [] });
  });

  it('rejects a missing version or list, bad ids, unknown keys and more than 100 brands', () => {
    for (const body of [
      {},
      { manufacturerIds: [] },
      { version: 1 },
      { version: 0, manufacturerIds: [] },
      { version: 1, manufacturerIds: ['nope'] },
      { version: 1, manufacturerIds: [], extra: 1 },
      { version: 1, manufacturerIds: Array.from({ length: 101 }, () => ID) },
    ]) {
      expect(setManufacturersBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
