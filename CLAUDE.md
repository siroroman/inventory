# Evidence majetku

Simple installable web app (PWA) for a small company to keep an inventory of assets: locations (with unlimited sub-locations), items with photos and service data, manufacturers, and service providers in a priority order. UI is Czech only. A handful of users (up to ~10).

Expected scale: tens of top-level locations, hundreds of sub-locations, hundreds to low thousands of items. Weigh this against the simplicity priority — don't build for scale this app doesn't have.

Priorities, in order: simplicity, reliability, security, user friendliness.

## Status

Scaffolded: pnpm monorepo and the API's database layer (Drizzle schema, migrations, least-privilege role, DB test suite). No API routes, `packages/shared` or SPA yet; no CI or Dockerfile yet. Keep this section and Commands current.

## References

- Working spec (English, day-to-day implementation reference): [SPEC.md](SPEC.md)
- Original spec, architecture, data model, API (Slovak; authoritative if it and SPEC.md ever disagree): https://claude.ai/code/artifact/b68ed72e-4c8a-4409-8e2a-c6b1408414aa
- UI design (mobile 390 px + desktop 1280 px, components and tokens): https://claude.ai/artifact/348Z5z5RWitYajoUzqSoDP

SPEC.md is the source of truth for implementation. If code and SPEC.md disagree, ask before changing either. SPEC.md §12 lists open questions (write-role permissions, record-ID generation, sub-location archiving, service-history depth, reminders, offline mode, budget/SLA, and more) — don't assume an answer, ask.

## Stack

- Frontend: React + TypeScript + Vite, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui (Radix), Lucide icons, React Hook Form + Zod, i18next (locale `cs`), vite-plugin-pwa
- API: Node.js 24 LTS + TypeScript, Hono + @hono/zod-openapi
- Database: PostgreSQL 17+, Drizzle ORM + drizzle-kit migrations
- Auth: Better Auth (email + password, Google), sessions in the same PostgreSQL. Do not use Auth.js.
- Files: S3-compatible object storage (Cloud Storage), private bucket, signed URLs for photos
- Email: transactional provider (e.g. Resend, Postmark) or Google Workspace SMTP, for invitations and password resets — exact provider open, see open questions
- Deploy: one Docker image (Node serves `/api/*` and the built SPA), Cloud Run, Cloud SQL, region europe-west3 (Frankfurt)
- Tests: Vitest, Testcontainers (PostgreSQL), Testing Library, MSW, Playwright

Local dev: Docker Compose runs PostgreSQL and a Cloud Storage emulator; the Vite dev server proxies `/api` to the local API. No staging environment until there's a reason for one.

## Repository layout (planned)

```
apps/api/          Hono API, Better Auth, Drizzle schema, migrations, seed
apps/web/          React SPA (PWA)
packages/shared/   Zod schemas, roles, types (used by both apps)
Dockerfile         multi-stage build, web + api in one image
```

pnpm workspaces. API and SPA are developed and tested separately and deployed together.

## Architecture rules

API is a modular monolith, one module per domain (`locations`, `items`, `photos`, `manufacturers`, `service-providers`, `users`, `audit`; later `inventory`). Each module has three layers, dependencies point down only:

- `routes`: HTTP, Zod validation, OpenAPI description, error mapping. No business logic.
- `service`: business rules, role checks, audit, transactions. Knows nothing about HTTP.
- `repository`: SQL via Drizzle only. No business rules.

Rules:

- Dependencies are passed through factory functions, e.g. `createItemService({ itemRepo, audit, clock })`. No global state, no singletons.
- Every write goes through a service, which writes the audit log in the same transaction.
- Roles (`read`, `write`, `admin`) are enforced on the server twice: `requireRole()` in the route and again in the service. Hiding a button in the SPA is not security.
- Zod schemas live in `packages/shared` and are the single source for form validation, API validation and OpenAPI.
- The SPA talks to the API only through the typed Hono RPC client (`hc`).

## API conventions

- REST under `/api/v1`, JSON, OpenAPI description served at `/api/v1/openapi.json`.
- Dates in ISO 8601. Errors are RFC 9457 (`problem+json`) with a machine-readable `code`; the SPA maps the code to Czech text, never hardcodes English error strings.
- Lists: `?q=` for search, `?limit=50&cursor=` for pagination.
- Updates go through `PATCH` with a `version` field; a stale version returns 409.
- Archive/restore via `POST /{id}/archive` and `/restore` — never `DELETE`.
- Photo URLs in responses are signed and valid for 15 minutes.

## Domain rules

- Locations form a tree via `parent_id` with unlimited depth. Use recursive SQL (`WITH RECURSIVE`) for the path up and for item counts over a whole subtree. A location must never become its own ancestor; check on every parent change.
- Location type is required only for top-level locations. Default types: HQ, Store, Site, Warehouse (extensible — a new type is just a new row).
- Items can belong to a location at any level. Item counts and item lists of a location include all its sub-locations.
- Items can have several external IDs (`source` + `value`, e.g. "Elektrikář: EL-4821"). The pair is unique across all items (archived included, case-insensitive); the same value under another source is allowed. Item search covers name, code, serial number, external IDs, manufacturer, model and location names.
- Search must ignore diacritics and case (`unaccent` + `pg_trgm`), sorting uses Czech collation.
- Manufacturer to service provider is many-to-many with a priority (1, 2, 3...). Priority is unique per manufacturer and is saved for the whole list in one transaction.
- Records are never hard-deleted: archive with `archived_at`, restore possible.
- Optimistic locking: updates send `version`; a stale version returns 409 (`conflict`).
- Every entity has an internal UUID `id` that never changes. Locations, items and service providers also have a unique human `code` (LOC-004, INV-00042, SUP-001), which will later be the content of QR labels (`/q/<code>`). Manufacturers have no code; location types use a short key (`HQ`, `STORE`).
- Every row also carries created_at/created_by/updated_at/updated_by, separate from the `audit_log` table.
- Dates are `date` (no time). Document links accept only https links to drive.google.com or docs.google.com.
- Roles: `read` views everything; `write` also creates and edits; `admin` also manages users and location types. Open question: whether `write` may manage manufacturers, providers and archiving (currently assumed yes).

## UI conventions

- Everything the user sees is Czech. All strings live in the i18n file, never hardcoded in components.
- Formats: date `27. 9. 2026`, Czech plurals (1 položka, 3 položky, 5 položek).
- Follow the UI design: shadcn/ui components, Tailwind, tokens from the design (accent `#2454C7`, neutral gray scale, status colors for overdue service, service within 30 days, expired warranty), system font, 4/8 px grid, radii 6/8/12 px.
- Mobile first. Touch targets at least 44 x 44 px. WCAG 2.2 AA contrast, full keyboard support.
- Every screen has loading (skeleton), empty, "nothing found" and error (with retry) states, plus a "Saved" toast on successful writes.
- Every screen has its own URL (deep links, browser back, future QR links). Active tab and search text are in the URL.
- Search runs live with a 300 ms debounce after the last keystroke.
- Forms warn before discarding unsaved changes; a 409 conflict on save shows a message instead of silently overwriting.

## Security

- Secrets only on the API, never in the SPA, never in git. Use Secret Manager in production and an untracked `.env` locally.
- Session cookie: HTTP-only, Secure, SameSite=Lax. SPA and API share one domain, so no CORS.
- Security headers set by Hono middleware: CSP, HSTS, X-Content-Type-Options, Referrer-Policy.
- Cloud SQL has a private IP only, reached from Cloud Run via Direct VPC egress — never expose the DB publicly. Cloud Run's service account is scoped to the minimum: DB connect, write to one bucket, read specific secrets.
- Photos: private bucket, upload only via signed URL for one file, max 10 MB, images only. The SPA resizes to max 2048 px before upload, which also strips EXIF/GPS.
- No self-registration. Only invited users can sign in; deactivating a user deletes their sessions.

## Testing

- Unit tests for services with fake repositories (rules, roles, audit, supplier order, cycles in the location tree).
- Integration tests for every API endpoint against a real PostgreSQL (Testcontainers), including 401, 403 and 409 cases. Use `app.request()`, no running server needed.
- Component tests for forms and search; Playwright E2E for the main flows (login, search by external ID, new sub-location, new item with photo, reorder service providers).
- Prefer fakes over mocks. No feature is done without tests for its rules.

## Database conventions

- `apps/api/src/db/schema/*.ts` holds what Drizzle can model. Custom SQL migrations (`pnpm --filter api db:generate --custom --name=<rule>`) hold the rest: extensions, `cs_cz` collation, functions, triggers, trigram indexes, the deferrable priority constraint, sequence ownership, grants and seed data. One migration per rule (e.g. `drizzle/0005_location_cycle_guard.sql`), committed together with its tests.
- `src/db/schema/auth.ts` is generated by `pnpm --filter api auth:generate` from `src/auth/auth.ts`. Never edit it by hand; rules Better Auth can't express (role CHECK, case-insensitive email) live in custom SQL.
- Never edit a migration that has been applied anywhere shared; add a new one. After changing the schema: `db:generate`, then `db:check`.
- Name every constraint and index explicitly and keep names under 63 characters (Postgres truncates silently). Constraint names are the contract for tests and API error mapping.
- Triggers own `updated_at` and `version`; repositories never set them and update with `WHERE version = $expected` (0 rows means 409 conflict).
- Location cycle protection relies on READ COMMITTED transactions (the default); don't raise the isolation level for tree moves.
- Search must match the indexed expression exactly: `f_unaccent(lower(col)) LIKE '%' || f_unaccent(lower($q)) || '%'`.
- The API connects as a member of `app_runtime` (no DDL, no DELETE on archivable tables, insert-only `audit_log`); migrations run as the owner via `MIGRATION_DATABASE_URL`. On Cloud SQL, run once: `GRANT app_runtime TO <app user>;`
- A new table needs grants in a migration and an index on every FK column; `test/db/privileges.test.ts` and `test/db/migrations.test.ts` fail until both exist.
- DB tests run as `app_runtime` by default (`useTestDb().app`); use `.owner` only for introspection. Each test gets a fresh database cloned from a migrated template.

## Commands

Prerequisites: Node 24 (`nvm use`), pnpm via corepack (`corepack enable pnpm`), Docker Desktop running with `docker` on PATH.

```
pnpm install                        # install deps, enable the commit-msg hook
pnpm typecheck                      # tsc in every package
pnpm test                           # all tests (DB tests start a Postgres container)
pnpm --filter api test:watch        # API tests in watch mode
pnpm db:up                          # start local Postgres 17 (docker compose)
pnpm db:migrate                     # apply migrations (needs MIGRATION_DATABASE_URL, see .env.example)
pnpm --filter api db:generate       # generate a migration from schema changes
pnpm --filter api db:generate --custom --name=<name>   # empty migration for custom SQL
pnpm --filter api db:check          # verify migration consistency
pnpm --filter api auth:generate     # regenerate Better Auth tables after auth config changes
```

For local runs, copy `.env.example` to `apps/api/.env`.

## Working agreement

- Work in small steps, one module or screen at a time: schema, repository, service with tests, routes with tests, then the UI.
- Before larger changes to the data model or architecture, propose the change first.
- Do not add dependencies without a reason. Keep it simple; this is a small internal app.
- Out of scope for v1 (but keep the design ready for it): QR inventory scanning, service history, e-mail reminders for service and warranty, offline mode, import/export. Do not build these unless asked.
- Code, identifiers and comments in English. UI text in Czech.
- CI gate before every deploy: lint, typecheck, all tests, build. Only a green build from main deploys. Migrations run as a Cloud Run job before the new version deploys; on failure the deploy stops and the old revision keeps running.

## Commits

- Format: [Conventional Commits](https://www.conventionalcommits.org), `type(scope): subject`.
  - Types: `feat`, `fix`, `test`, `refactor`, `perf`, `build`, `ci`, `docs`, `chore`, `revert`.
  - Scope is optional, lowercase: the module or area (`db`, `auth`, `locations`, `items`, `photos`, `web`, `shared`, `repo`, `deps`).
  - Subject is imperative, starts lowercase, no trailing period; header at most 72 characters. `!` before the colon marks a breaking change.
- For anything non-trivial, add a body after a blank line explaining why (wrap at 72).
- One small logical change per commit. Every commit is green (typecheck and tests pass), so `git bisect` works and any commit could ship. Tests land in the same commit as the code they cover.
- No `Co-Authored-By` or other AI attribution trailers.
- Commit directly to `main` for now; switch to feature branches and PRs once CI exists.
- `.githooks/commit-msg` enforces the format; `pnpm install` enables it (`git config core.hooksPath .githooks`). Never bypass it with `--no-verify`.
