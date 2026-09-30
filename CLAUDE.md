# Evidence majetku

Simple installable web app (PWA) for a small company to keep an inventory of assets: locations (with unlimited sub-locations), items with photos and service data, manufacturers, and service providers in a priority order. UI is Czech only. A handful of users (up to ~10).

Expected scale: tens of top-level locations, hundreds of sub-locations, hundreds to low thousands of items. Weigh this against the simplicity priority — don't build for scale this app doesn't have.

Priorities, in order: simplicity, reliability, security, user friendliness.

## Status

Scaffolded: pnpm monorepo and the API's database layer (Drizzle schema, migrations, least-privilege role, DB test suite), a repository per module in `apps/api/src/modules/<module>/repository.ts` (shared helpers in `src/db/`: `search.ts`, `pagination.ts`, `versioned.ts`), and a dev seed. Services (all modules): `locations` (with location types), `items`, `manufacturers`, `service-providers`, `photos`, `users` and `audit` (read). Services take `{ repos, transact }` (`src/db/transaction.ts`), throw `DomainError` codes (`src/errors.ts`), and are unit-tested with in-memory fakes from `test/fakes/` plus a short `service.db.test.ts` per service against real PostgreSQL. Things outside the database sit behind ports injected into the service: `PhotoStorage` (`modules/photos/storage.ts`, Cloud Storage adapter not written; `server.ts` passes a stub that fails photo calls that reach the bucket) and `UserInvites` (`modules/users/service.ts`, Better Auth + email adapter not written; `server.ts` passes a stub, so `POST /users` returns a logged 500 until it exists); tests use fakes. Database errors such as unique-constraint violations are not translated in services; the HTTP layer maps constraint names (registry in `src/http/errors.ts`, e.g. `item_external_ids_source_value_key`, `manufacturers_name_lower_key`, `item_photos_storage_key_key`). `packages/shared` (`@inventory/shared`, plain TS source, no build) holds roles, the error code list and the Zod schemas both apps use; so far the foundation (problem details, id/paging/version, `/me`), locations, location types, items, manufacturers, service providers, photos and users. The HTTP layer is in place (see HTTP layer below) with `health`, `me`, and the locations, location-types, items, photos, manufacturers, service-providers and users routes (`modules/<m>/routes.ts`, DTO mappers in `dto.ts`); no audit routes yet. A `Dockerfile` builds one image (API + built SPA, which the API serves when `STATIC_DIR` is set, `src/http/spa.ts`); `deploy/` holds the scripts for a test deployment on Google Cloud (Cloud Run + Cloud SQL, see `deploy/README.md`; public-IP Cloud SQL); `.github/workflows/deploy.yml` deploys `main` after a green CI run (Workload Identity Federation, no keys). `apps/web` is scaffolded (see Frontend below): Vite + React + Tailwind + shadcn/ui, design tokens in light and dark, Vitest; foundation in place (TanStack Router file routes, TanStack Query, typed `hc` client, Czech i18n, error mapping, app shell, toaster) and email + password sign-in (login screen, route guard with return-to-URL, user menu with sign-out; no Google sign-in, password reset or invitation acceptance yet) the Home screen (Locations and Items tabs, live search, paging; location names and item rows link to their detail; "Přidat lokalitu" / "Přidat položku" for write roles), the location detail screen (`/locations/$id`: breadcrumb, fields, sub-locations, items of the subtree; Edit and Add sub-location for write roles, no Archive yet), the location form (`/locations/new[?parentId=]`, `/locations/$id/edit`) and the item detail (`/items/$id`, `features/items/item-detail.tsx`: photo gallery, fields, warranty and service badges, Edit for write roles; no Archive, the location path links to each location's detail, the manufacturer is plain text until its screen exists) and the add/edit item form (`/items/new`, `/items/$id/edit`, see Frontend; no photos yet), but no other domain screens yet. CI runs on every PR (see CI below). Keep this section and Commands current.

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
- Lists: `?q=` for search, `?limit=50&cursor=` for pagination (default page 50; the SPA lists ask for 20, `listPageSize` in `src/lib/query.ts`).
- Updates go through `PATCH` with a `version` field; a stale version returns 409.
- Archive/restore via `POST /{id}/archive` and `/restore` — never `DELETE`.
- Photo URLs in responses are signed and valid for 15 minutes.

## Domain rules

- Locations form a tree via `parent_id` with unlimited depth. Use recursive SQL (`WITH RECURSIVE`) for the path up and for item counts over a whole subtree. A location must never become its own ancestor; check on every parent change.
- Location type is required only for top-level locations. Default types: HQ, Store, Site, Warehouse (extensible — a new type is just a new row).
- Items can belong to a location at any level, or to none yet (`location_id` is nullable; the API answers `location: null` and an empty `path`, the list shows a dash). Item counts and item lists of a location include all its sub-locations.
- Items can have several external IDs (`source` + `value`, e.g. "Elektrikář: EL-4821"). The pair is unique across all items (archived included, case-insensitive); the same value under another source is allowed. Item search covers name, code, serial number, external IDs, manufacturer, model and location names.
- Search must ignore diacritics and case (`unaccent` + `pg_trgm`), sorting uses Czech collation.
- Manufacturer to service provider is many-to-many with a priority (1, 2, 3...). Priority is unique per manufacturer and is saved for the whole list in one transaction.
- Records are never hard-deleted: archive with `archived_at`, restore possible.
- Optimistic locking: updates send `version`; a stale version returns 409 (`conflict`).
- Every entity has an internal UUID `id` that never changes. Locations, items and service providers also have a unique human `code` (LOC-004, INV-00042, SUP-001), which will later be the content of QR labels (`/q/<code>`). A location's code may be chosen on creation (optional `code` on `POST /locations`: trimmed, upper-cased, `A-Z 0-9 . _ -`, at most 30 characters, unique, `duplicate_location_code` 409) and is fixed afterwards; without one the database generates the next LOC-nnn. Item and provider codes are still always generated. Manufacturers have no code; location types use a short key (`HQ`, `STORE`).
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

## HTTP layer

- `src/app.ts` `createApp({ auth, baseUrl, isProduction, log })` builds the API; `src/server.ts` is the entry point (config from env via `src/config.ts`, graceful shutdown). Middleware order: request id, JSON access log, security headers, body limit (1 MB), error handling, Better Auth at `/api/auth/*`, CSRF, authentication.
- Every `/api/v1` path is authenticated by default. Only paths in `publicPaths` (`app.ts`) skip it; adding one is a deliberate security decision.
- Build routes on `createRouter()` (`src/http/router.ts`, installs the validation hook) and define them with `defineRoute({ minRole, ... })` (`src/http/route.ts`), never bare `createRoute`; it attaches `requireRole`, records `x-min-role` in OpenAPI and adds the 401/403 responses. `test/http/openapi.test.ts` fails on any operation without a role or that answers an anonymous caller.
- Errors are `problem+json` (`src/http/errors.ts`). `statusByCode` covers every code in `@inventory/shared` (typecheck fails on a new code without a status): 409 = clashes with current state, 422 = refers to something missing or not allowed. Unique-constraint names map through `constraintErrors`; add a module's names there. Unexpected errors return a generic 500 and are logged without driver error messages (they contain query parameters).
- `createApp` receives the `Services` bag (`src/services.ts`); a module's routes are `createXRoutes(services)` in `modules/<m>/routes.ts`, chained onto the app in `app.ts` so `AppType` keeps them. Responses are DTOs (`dto.ts` per module, `recordDto` in `src/http/dto.ts` turns the record fields' `Date`s into ISO strings) that must match the shared schema; route tests parse each response with it (`expectJson`).
- Tests build the app with `createTestApp(db)` and sign in with `loginAs(app, db, role)` (`test/helpers/app.ts`): real Better Auth, real cookie, `app.request()`.
- The session cookie is refreshed by the authentication middleware (sliding 7-day session). Deactivated users cannot start a session (Better Auth database hook) and are refused even if one survives.
- Dependency versions must pass the workspace release-age policy. If pnpm offers to add `minimumReleaseAgeExclude`, pick an older release instead.

## Frontend

- `apps/web` is a Vite SPA. Alias `@/` = `src/`. Tests live in `apps/web/test/` (Vitest, jsdom, Testing Library). `vite build` writes `dist/`, which the API image will serve.
- Design tokens are CSS variables in `src/index.css` (values from the UI design; SPEC.md §11), mapped into Tailwind's `@theme`. shadcn's `accent` is the hover surface; the design's accent colour is `primary`. Never hardcode a hex in a component, use a token class (`bg-primary`, `text-muted-foreground`, `bg-danger-soft`...).
- Light and dark themes: the design only defines light, the dark values are derived and keep WCAG AA. `src/lib/theme.ts` follows the system setting via the `dark` class; there is no manual toggle yet. `--input` (form control borders) is darker than the design's gray-300, which fails the 3:1 non-text contrast.
- shadcn components are added with the CLI config in `components.json` into `src/components/ui/`, then adjusted to the design (44 px default height, 36 px small).
- With the Vite dev server the browser origin is `http://localhost:5173`, so the API's `BETTER_AUTH_URL` must be that origin for cookies and CSRF checks; with any other value sign-in fails the origin check. Component tests stub the network with `stubApi` (`test/helpers.tsx`), which replaces the global `fetch` per test.
- Auth: `src/features/auth/`. The session is the `['me']` query (`meQueryOptions`); `currentUser(queryClient)` reads it (cached 30 s, no retry) and is used by the guards. Sign-in and sign-out (`api.ts`) call Better Auth with plain `fetch`, not `unwrap` (its errors are `{ code, message }`, not problem+json): `INVALID_EMAIL_OR_PASSWORD` becomes `invalid_credentials`, `FAILED_TO_CREATE_SESSION` (deactivated account) becomes `no_access`. Sign-out clears the whole query cache before going to `/login`. `safeRedirect` allows only same-site paths in `?redirect=`. `createAppRouter` also wires `redirectOnExpiredSession`: a 401 `unauthenticated` from any later query or mutation forgets the cached user and re-runs the guards, so an expired or deactivated session lands on `/login?redirect=<url>`. The router shows `RoutePending` (skeleton) for loads slower than 300 ms.
- Routes: every screen that needs a signed-in user is a child of the pathless `src/routes/_app.tsx` layout (guard in `beforeLoad`, renders `AppShell`); `login.tsx` and the not-found page are outside it. A new screen goes in `src/routes/_app/`. A non-401 failure of the guard (server down) shows the route error with retry, never a redirect to login.
- Layout: `src/routes/` (file-based, thin; `routeTree.gen.ts` is generated by the Vite plugin, committed and excluded from Biome), `src/components/` (`ui/` = shadcn), `src/lib/` (`api.ts`, `problem.ts`, `query.ts`, `format.ts`, `theme.ts`), `src/i18n/`. Features go in `src/features/<domain>/`.
- Home: `src/routes/_app/index.tsx` keeps the tab (`?tab=items`; missing = locations) and the search text (`?q=`) in the URL; `SearchBox` debounces 300 ms and replaces the history entry. Each tab is a panel in `src/features/<domain>/` (`LocationsPanel`, `ItemsPanel`) built from `ListToolbar` and `PagedList` (`src/components/`), which own the skeleton, empty, nothing-found, error and load-more states over a `useInfiniteQuery` (`pagedListQueryOptions` in `src/lib/query.ts`: `keepPreviousData` between searches, `gcTime: 0` so a list that is left starts at page one again). `PagedList` renders a real `<table>` (column headings, `Column<T>` definitions) from 768 px up and cards below it, choosing with `useMediaQuery`, so only one layout is in the DOM; tests default to the card layout, `stubWideScreen(true)` (`test/helpers.tsx`) switches to the table. `renderApp` builds the query client without retries. Service badges come from `serviceStatus` (`src/lib/service-status.ts`).
- Item form: `features/items/item-form.tsx` (react-hook-form + zod; field rules and the form-to-body mapping in `item-form-values.ts`, the same shared limits, the API validates again). Used for `/items/new` and `/items/$id/edit` (`item-edit.tsx` loads the item fresh and shows a forbidden state to `read`). The ID is optional on creation (`humanCode` in shared: upper-cased, A-Z 0-9 . _ -, at most 30; empty = the database assigns INV-nnnnn; a taken one is `duplicate_item_code`) and read-only afterwards; one empty external ID row is always shown and empty rows are not sent. `/items/new?locationId=` starts the item in that location (the location detail's items section links to it; its sub-locations section has the matching "Přidat podlokalitu"; both are blue buttons in the section header, shown to writers on a non-archived location, and an empty sub-locations section stays for them). An edit PATCHes only the fields that changed, with `version`; a 409 shows the conflict text with "Načíst aktuální data", which refetches and remounts the form (`key={version}`). Errors from the API show above the buttons (`silentError`). Unsaved changes are guarded by `UnsavedChangesGuard`. Location and manufacturer (both optional) are chosen with `SearchPicker` (results collapsed until the field is focused; a chosen value is a field you tap to search again, `clearable` adds an empty button for optional ones) (`components/search-picker.tsx`, live search over `GET /locations?q=` at every level and `GET /manufacturers?q=`); the manufacturer picker can create a new name on the spot. `useCanWrite()` (`features/auth/use-can-write.ts`) only decides which buttons show. Photos are not in the form yet (needs the Cloud Storage adapter).
- Location detail: `src/routes/_app/locations/$id.tsx` renders `LocationDetail` (`src/features/locations/location-detail.tsx`). It loads the location (`locationQueryOptions`; the `not_found` / `validation_error` of a bad id show the not-found page, other errors `ErrorState` with retry) and two `PagedList`s under it: the direct sub-locations (`?parentId=`) and the items of the whole subtree (`/locations/{id}/items`), each with its own state. Table columns and cards are shared with Home through `useLocationRows({ nested })` and `useItemRows()`; a location's name is the link to its detail (the whole row on cards). The route takes the UUID; there is no lookup by code (`/q/<code>`) yet.
- Location form: `src/features/locations/location-form.tsx` (React Hook Form + `formSchema`, sends `POST` or `PATCH` with `version`), `location-picker.tsx` (parent search-and-pick, top level when empty), `location-form-screen.tsx` (`NewLocation`, `EditLocation`: role gate via `useCanWrite`, loads the location/parent, edit always refetches). Routes `locations/new.tsx` and `locations/$id_.edit.tsx` (the `_` keeps edit a sibling of the detail route). Errors show inline above the buttons (`silentError`); a `conflict` offers "Načíst aktuální údaje" which reloads the record and resets the form. `UnsavedChangesGuard` (`components/`, `useBlocker` + an in-app `AlertDialog`, never `window.confirm`: it is not shown in every browser view and then blocks all navigation) warns before discarding changes. `Select` (native) and `Textarea` are in `components/ui/`; `ListToolbar` takes an `action` for the Add button.
- API calls: `api` in `src/lib/api.ts` is `hc<AppType>` (type-only import of `apps/api/src/app.ts`, no API package change). Wrap every call in `unwrap(api.api.v1....$get())`: it returns the typed body or throws `ApiError` with the `code` from the problem+json (`network` / `unexpected` when there is none).
- Errors: `problemMessage(error)` gives the Czech text for an error code. Texts live in `errors.*` in `cs.json`. `t()` keys are typed from `cs.json`, so a new code in `@inventory/shared` fails the typecheck until it has Czech text.
- Query: failed queries are rendered by their screen (`ErrorState` with retry); failed mutations toast the Czech message unless the mutation sets `meta: { silentError: true }` (forms showing field errors or a 409). 4xx errors are not retried.
- i18n: `t('...')` in components; outside components import `i18n` from `@/i18n`. Dates via `formatDate` (`27. 9. 2026`), counts with `_one/_few/_many/_other` keys (see `common.itemCount`).

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
pnpm lint                           # Biome static analysis (warnings fail too)
pnpm build                          # build every package that has a build script
pnpm test                           # all tests (DB tests start a Postgres container)
pnpm --filter api test:watch        # API tests in watch mode
pnpm --filter web dev               # run the SPA on http://localhost:5173 (proxies /api to :8080)
                                    # API_ORIGIN=http://localhost:8090 sends /api elsewhere (a second checkout); add `-- --port 5174 --strictPort` and match BETTER_AUTH_URL
pnpm --filter api dev               # run the API with reload (needs apps/api/.env, see .env.example, and pnpm db:up + db:migrate)
pnpm --filter api start             # run the API once (Node 24 runs the TypeScript directly)
pnpm db:up                          # start local Postgres 17 (docker compose)
pnpm db:migrate                     # apply migrations (needs MIGRATION_DATABASE_URL, see .env.example)
pnpm db:seed                        # fill an empty local DB with sample data and admin@/write@/read@example.test users (needs SEED_USER_PASSWORD)
pnpm --filter api db:seed:bulk       # add 100 locations and 2000 items to a seeded local DB (paging and search; refuses if it has >500 items)
pnpm --filter api db:generate       # generate a migration from schema changes
pnpm --filter api db:generate --custom --name=<name>   # empty migration for custom SQL
pnpm --filter api db:check          # verify migration consistency
pnpm --filter api auth:generate     # regenerate Better Auth tables after auth config changes
docker build -t inventory .         # the production image (serves /api and the SPA on :8080)
deploy/setup.sh                     # one-time Google Cloud setup (see deploy/README.md)
deploy/setup-github.sh              # one-time: let GitHub Actions deploy main (see deploy/README.md)
deploy/deploy.sh                    # build, migrate and deploy the committed HEAD to Cloud Run
```

For local runs, copy `.env.example` to `apps/api/.env`. `BETTER_AUTH_URL` there must be the Vite dev origin, `http://localhost:5173`; an older copy with `http://localhost:8080` makes sign-in, sign-out and every write from the SPA fail with "Invalid origin", so change it and restart the API.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. Four jobs, all must pass:

- `Lint, typecheck, test`: `pnpm lint` (Biome, `biome.jsonc`; formatter off, generated `auth.ts` excluded), `pnpm typecheck`, `db:check`, `pnpm build`, `pnpm test` (DB tests use the runner's Docker via Testcontainers).
- `Dependency audit`: `pnpm audit --audit-level high`.
- `Secret scan`: gitleaks over the full git history.
- `Semgrep`: free registry rules for TypeScript/JavaScript/Node.js (SAST); any finding fails.

`.github/workflows/deploy.yml` runs after CI succeeds on a push to `main` (or by hand): builds the image on the runner, then `deploy/release.sh` migrates and deploys. It signs in to Google Cloud through Workload Identity Federation (repository variables `GCP_*`, set by `deploy/setup-github.sh`).

Actions are pinned to commit SHAs and scanner images to versions; update them deliberately. Making these jobs required status checks on `main` is a GitHub repository setting (branch protection), not part of the workflow file.

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
- Work on a feature branch and open a PR into `main`; CI must be green to merge. Never commit directly to `main`.
- `.githooks/commit-msg` enforces the format; `pnpm install` enables it (`git config core.hooksPath .githooks`). Never bypass it with `--no-verify`.
