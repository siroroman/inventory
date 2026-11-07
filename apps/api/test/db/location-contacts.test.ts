import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { locationContacts } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertLocation } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('location_contacts', () => {
  const t = useTestDb();
  type Contact = Partial<typeof locationContacts.$inferInsert>;
  const add = (locationId: string, contact: Contact = {}) =>
    t().app.insert(locationContacts).values({ locationId, sortOrder: 0, role: 'Správce', phone: '601 123 456', ...contact });

  it('keep several contacts of a location in their order', async () => {
    const location = await insertLocation(t().app);
    await add(location.id, { sortOrder: 1, role: 'Prodejna', phone: '+420 495 111 222' });
    await add(location.id, { sortOrder: 0, role: 'Majitel budovy', name: 'Jan Novák', phone: null, email: 'novak@example.cz' });
    const rows = await t()
      .app.select()
      .from(locationContacts)
      .where(eq(locationContacts.locationId, location.id))
      .orderBy(locationContacts.sortOrder);
    expect(rows.map((row) => row.role)).toEqual(['Majitel budovy', 'Prodejna']);
  });

  it('reject two contacts at the same place of one list', async () => {
    const location = await insertLocation(t().app);
    await add(location.id);
    await expectPgError(add(location.id, { role: 'Prodejna' }), {
      code: PG.uniqueViolation,
      constraint: 'location_contacts_location_id_sort_order_key',
    });
  });

  it('reject a blank role', async () => {
    const location = await insertLocation(t().app);
    await expectPgError(add(location.id, { role: '  ' }), {
      code: PG.checkViolation,
      constraint: 'location_contacts_role_not_blank',
    });
  });

  it.each([
    ['neither', { phone: null, email: null }],
    ['only blanks', { phone: ' ', email: '' }],
  ])('reject a contact with no phone and no email (%s)', async (_, contact) => {
    const location = await insertLocation(t().app);
    await expectPgError(add(location.id, contact), {
      code: PG.checkViolation,
      constraint: 'location_contacts_phone_or_email',
    });
  });

  it('reject an unknown location', async () => {
    await expectPgError(add(randomUUID()), {
      code: PG.foreignKeyViolation,
      constraint: 'location_contacts_location_id_locations_id_fk',
    });
  });
});
