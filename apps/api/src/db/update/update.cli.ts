// Entry point for `pnpm --filter api db:update-inventory <accounting.csv> <decisions.json> --out <dir>`
// [--apply --expect <fingerprint>]. Without --apply it is a dry run: it prints the summary and writes
// the review files into --out. With it, DATABASE_URL must be the owner's connection (it sets the
// code sequence). deploy/update.sh runs it against Cloud SQL.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { createDb } from '../client.ts';
import { runAccountingUpdate } from './accounting-update.ts';
import { AlreadyAppliedError, type Plan } from './plan.ts';

const decisionsSchema = z.strictObject({
  asOf: z.iso.date(),
  newLocations: z.record(z.string(), z.strictObject({ name: z.string().trim().min(1), type: z.string().min(1) })).default({}),
  merge: z.record(z.string(), z.string()).default({}),
  skip: z.record(z.string(), z.string()).default({}),
});

function usage(): never {
  console.error(
    'Usage: db:update-inventory <accounting.csv> <decisions.json> --out <dir> [--apply --expect <fingerprint>]\n' +
      'with DATABASE_URL set (the owner\'s for --apply) and optionally ACTOR_EMAIL (default admin@example.test)',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
// The two files come first, then the flags.
const [csvPath, decisionsPath] = args;
const out = flag('--out');
const apply = args.includes('--apply');
const expect = flag('--expect');
const url = process.env.DATABASE_URL;
if (!csvPath || !decisionsPath || !out || !url || (apply && !expect)) usage();

// pnpm runs the script in apps/api; relative paths mean the directory it was started from.
const fromStart = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (header: string[], rows: unknown[][]) =>
  `${[header, ...rows].map((r) => r.map(quote).join(',')).join('\n')}\n`;

async function writeReports(dir: string, plan: Plan) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'mapping.csv'),
    csv(
      ['new_code', 'old_code', 'kind', 'accounting_id', 'name'],
      [
        ...plan.updates.map((u) => [u.newCode, u.oldCode, u.kind, u.key, u.name]),
        ...plan.creates.map((c) => [c.newCode, '', 'new', c.key, c.name]),
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  );
  await writeFile(
    join(dir, 'changes.csv'),
    csv(
      ['old_code', 'new_code', 'kind', 'field', 'from', 'to'],
      plan.updates.flatMap((u) =>
        Object.entries(u.changes)
          .filter(([field]) => field !== 'code')
          .map(([field, c]) => [u.oldCode, u.newCode, u.kind, field, JSON.stringify(c.from), JSON.stringify(c.to)]),
      ),
    ),
  );
  await writeFile(
    join(dir, 'new-items.csv'),
    csv(
      ['new_code', 'accounting_id', 'location', 'registered_on', 'price', 'name', 'sheet', 'table'],
      plan.creates.map((c) => [c.newCode, c.key, c.locationCode, c.registeredOn, c.purchasePrice, c.name, c.sheet, c.table]),
    ),
  );
  await writeFile(
    join(dir, 'review.csv'),
    csv(
      ['accounting_id', 'name', 'centre', 'candidate_code', 'candidate_name', 'score'],
      plan.review.flatMap((r) => r.candidates.map((c) => [r.key, r.name, r.centre, c.code, c.name, c.score])),
    ),
  );
  await writeFile(
    join(dir, 'left-alone.csv'),
    csv(
      ['code', 'name', 'why'],
      [
        ...plan.skipped.map((s) => [s.key, s.name, `skipped: ${s.reason}`]),
        ...plan.notInWorkbook.map((n) => [n.code, n.name, 'accounting item missing from the workbook']),
        ...plan.updates.flatMap((u) => u.conflicts.map((why) => [u.oldCode, u.name, why])),
      ],
    ),
  );
}

const decisions = decisionsSchema.parse(JSON.parse(await readFile(fromStart(decisionsPath!), 'utf8')));
const { db, pool } = createDb(url!, { statementTimeoutMs: 60_000, idleInTransactionTimeoutMs: 120_000 });
try {
  const { plan, applied } = await runAccountingUpdate(db, {
    rowsCsv: await readFile(fromStart(csvPath!), 'utf8'),
    decisions,
    apply,
    expect,
    actorEmail: process.env.ACTOR_EMAIL ?? 'admin@example.test',
  });
  await writeReports(fromStart(out!), plan);
  const count = (kind: string) => plan.updates.filter((u) => u.kind === kind).length;
  console.log(applied ? 'APPLIED' : 'DRY RUN (nothing written)', {
    items: plan.lastNumber,
    existing: plan.updates.length,
    matched: count('matched'),
    merged: count('merged'),
    moved: count('moved'),
    electricianOnly: count('electrician-only'),
    created: plan.creates.length,
    newLocations: plan.newLocations.map((l) => l.code),
    reviewRows: plan.review.length,
    skipped: plan.skipped.length,
    fieldChanges: plan.updates.filter((u) => Object.keys(u.fields).length > 0).length,
    fingerprint: plan.fingerprint,
  });
} catch (error) {
  if (!(error instanceof AlreadyAppliedError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
