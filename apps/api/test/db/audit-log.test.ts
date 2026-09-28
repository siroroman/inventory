import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertUser } from '../helpers/factories.ts';
import { expectPgError, PG } from '../helpers/pg-error.ts';

describe('audit_log', () => {
  const t = useTestDb();
  const entry = (overrides: Partial<typeof auditLog.$inferInsert> = {}) =>
    t()
      .app.insert(auditLog)
      .values({ entityType: 'location', entityId: randomUUID(), action: 'update', ...overrides })
      .returning();

  it('stores who changed what, with the change set as jsonb', async () => {
    const author = await insertUser(t().app);
    const changes = { name: { from: 'Sklad', to: 'Sklad Brno' }, note: { from: null, to: 'Přestěhováno' } };
    const [row] = await entry({ userId: author.id, changes });
    const [read] = await t().app.select().from(auditLog).where(eq(auditLog.id, row!.id));
    expect(read).toMatchObject({ userId: author.id, action: 'update', changes });
    expect(read!.occurredAt).toBeInstanceOf(Date);
  });

  it('allows system entries without a user', async () => {
    await entry({ userId: null, action: 'create' });
  });

  it('rejects an unknown user', async () => {
    await expectPgError(entry({ userId: randomUUID() }), {
      code: PG.foreignKeyViolation,
      constraint: 'audit_log_user_id_user_id_fk',
    });
  });

  it.each(['create', 'update', 'archive', 'restore', 'delete'])('accepts action %s', async (action) => {
    await entry({ action });
  });

  it('rejects an unknown action', async () => {
    await expectPgError(entry({ action: 'purge' }), { code: PG.checkViolation, constraint: 'audit_log_action_valid' });
  });

  it('assigns increasing ids', async () => {
    const [a] = await entry();
    const [b] = await entry();
    expect(b!.id).toBeGreaterThan(a!.id);
  });
});
