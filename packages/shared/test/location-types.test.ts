import { describe, expect, it } from 'vitest';
import { createLocationTypeBody, updateLocationTypeBody } from '../src/index.ts';

describe('createLocationTypeBody', () => {
  it('takes an upper-case key, a name and an optional order', () => {
    expect(createLocationTypeBody.parse({ code: 'KIOSK', name: ' Kiosek ' })).toEqual({ code: 'KIOSK', name: 'Kiosek' });
    expect(createLocationTypeBody.parse({ code: 'WARE_HOUSE2', name: 'Sklad', sortOrder: 4 })).toMatchObject({ sortOrder: 4 });
  });

  it.each(['kiosk', 'Kiosek', '1KIOSK', 'KIO SK', '', 'A'.repeat(21)])('rejects the code %j', (code) => {
    expect(createLocationTypeBody.safeParse({ code, name: 'X' }).success).toBe(false);
  });

  it('rejects a missing or blank name, a bad order and unknown keys', () => {
    for (const body of [{ code: 'K' }, { code: 'K', name: ' ' }, { code: 'K', name: 'X', sortOrder: -1 }, { code: 'K', name: 'X', sortOrder: 1.5 }, { code: 'K', name: 'X', id: 'x' }]) {
      expect(createLocationTypeBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('updateLocationTypeBody', () => {
  it('changes the name and order, and needs the version and one of them', () => {
    expect(updateLocationTypeBody.parse({ version: 1, name: 'Stánek' })).toEqual({ version: 1, name: 'Stánek' });
    expect(updateLocationTypeBody.safeParse({ version: 1 }).success).toBe(false);
    expect(updateLocationTypeBody.safeParse({ name: 'X' }).success).toBe(false);
  });

  it('does not let the code change', () => {
    expect(updateLocationTypeBody.safeParse({ version: 1, code: 'WH' }).success).toBe(false);
  });
});
