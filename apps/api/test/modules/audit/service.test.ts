import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../../../src/auth/roles.ts';
import { createAuditService } from '../../../src/modules/audit/service.ts';
import { createFakeAuditRepository } from '../../fakes/audit.ts';
import { expectCode } from '../../helpers/service-errors.ts';

describe('audit service', () => {
  const setup = () => {
    const audit = createFakeAuditRepository();
    return { audit, service: createAuditService({ repos: { audit } }) };
  };
  const locationId = randomUUID();

  it('returns the history of one record, newest first', async () => {
    const { audit, service } = setup();
    await audit.record({ userId: null, entityType: 'location', entityId: locationId, action: 'create' });
    await audit.record({ userId: null, entityType: 'item', entityId: locationId, action: 'create' });
    await audit.record({ userId: null, entityType: 'location', entityId: locationId, action: 'archive' });

    const page = await service.history({ id: 'a', role: 'admin' }, { entityType: 'location', entityId: locationId }, { limit: 50 });
    expect(page.items.map((e) => e.action)).toEqual(['archive', 'create']);
  });

  it('is for admins only', async () => {
    const { service } = setup();
    for (const role of ['read', 'write'] as const) {
      const actor: Actor = { id: 'u', role };
      await expectCode(service.history(actor, { entityType: 'location', entityId: locationId }, { limit: 50 }), 'forbidden');
    }
  });
});
