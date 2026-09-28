import { asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.ts';
import { session, user } from '../../db/schema/index.ts';

export type Role = 'read' | 'write' | 'admin';
export type User = typeof user.$inferSelect;

// Better Auth creates users, accounts and sessions; this covers what the admin screens change.
export function createUserRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<User | undefined> {
      const [row] = await db.select().from(user).where(eq(user.id, id));
      return row;
    },

    /** Case-insensitive, like the unique index on email. */
    async findByEmail(email: string): Promise<User | undefined> {
      const [row] = await db.select().from(user).where(sql`lower(${user.email}) = lower(${email})`);
      return row;
    },

    /** All users by name (Czech collation). Up to ~10 users, so no paging. */
    list(): Promise<User[]> {
      return db.select().from(user).orderBy(asc(user.name), asc(user.id));
    },

    async setRole(id: string, role: Role): Promise<User | undefined> {
      const [row] = await db.update(user).set({ role }).where(eq(user.id, id)).returning();
      return row;
    },

    /** Deactivating does not end sessions by itself; the service also calls deleteSessions. */
    async setActive(id: string, isActive: boolean): Promise<User | undefined> {
      const [row] = await db.update(user).set({ isActive }).where(eq(user.id, id)).returning();
      return row;
    },

    /** Signs the user out everywhere. Returns how many sessions ended. */
    async deleteSessions(userId: string): Promise<number> {
      const rows = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
      return rows.length;
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
