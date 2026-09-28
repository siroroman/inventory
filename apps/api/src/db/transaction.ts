import type { Db, DbExecutor } from './client.ts';

/**
 * Runs work in one transaction with repositories bound to it. Services depend on this instead of
 * the database, so unit tests can pass fake repositories.
 */
export type Transact<Repos> = <T>(work: (repos: Repos) => Promise<T>) => Promise<T>;

export function transactor<Repos>(db: Db, build: (tx: DbExecutor) => Repos): Transact<Repos> {
  return (work) => db.transaction((tx) => work(build(tx)));
}
