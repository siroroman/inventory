import { readFile } from 'node:fs/promises';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/db/migrate.ts';

export type PgTestConfig = {
  host: string;
  port: number;
  ownerUser: string;
  ownerPassword: string;
  appUser: string;
  appPassword: string;
  templateDb: string;
};

declare module 'vitest' {
  export interface ProvidedContext {
    pg: PgTestConfig;
  }
}

const TEMPLATE_DB = 'app_template';

// One container per run; every test gets its own database cloned from the migrated template.
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17')
    .withDatabase(TEMPLATE_DB)
    .withUsername('owner')
    .withPassword('owner')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .start();

  const ownerUrl = container.getConnectionUri();

  // Same role setup as the local docker-compose database.
  const rolesSql = await readFile(new URL('../../../docker/db-init/01-roles.sql', import.meta.url), 'utf8');
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(rolesSql);
  await client.end();

  await runMigrations(ownerUrl);

  project.provide('pg', {
    host: container.getHost(),
    port: container.getPort(),
    ownerUser: 'owner',
    ownerPassword: 'owner',
    appUser: 'inventory_app',
    appPassword: 'inventory_app',
    templateDb: TEMPLATE_DB,
  });

  return async () => {
    await container.stop();
  };
}
