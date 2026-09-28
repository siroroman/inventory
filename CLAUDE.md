# Evidence majetku

Simple installable web app (PWA) for a small company to keep an inventory of assets: locations (with unlimited sub-locations), items with photos and service data, manufacturers, and service providers in a priority order. UI is Czech only. A handful of users (up to ~10).

Priorities, in order: simplicity, reliability, security, user friendliness.

## Status

Greenfield: no code yet. Update this file as the project is scaffolded (especially the Commands section).

## References

- Spec, architecture, data model, API: https://claude.ai/code/artifact/b68ed72e-4c8a-4409-8e2a-c6b1408414aa
- UI design (mobile 390 px + desktop 1280 px, components and tokens): https://claude.ai/artifact/348Z5z5RWitYajoUzqSoDP

The spec is the source of truth. If code and spec disagree, ask before changing either.

## Stack

- Frontend: React + TypeScript + Vite, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui (Radix), Lucide icons, React Hook Form + Zod, i18next (locale `cs`), vite-plugin-pwa
- API: Node.js 24 LTS + TypeScript, Hono + @hono/zod-openapi
- Database: PostgreSQL 17+, Drizzle ORM + drizzle-kit migrations
- Auth: Better Auth (email + password, Google), sessions in the same PostgreSQL. Do not use Auth.js.
- Files: S3-compatible object storage (Cloud Storage), private bucket, signed URLs for photos
- Deploy: one Docker image (Node serves `/api/*` and the built SPA), Cloud Run, Cloud SQL
- Tests: Vitest, Testcontainers (PostgreSQL), Testing Library, MSW, Playwright

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

## Domain rules

- Locations form a tree via `parent_id` with unlimited depth. Use recursive SQL (`WITH RECURSIVE`) for the path up and for item counts over a whole subtree. A location must never become its own ancestor; check on every parent change.
- Location type is required only for top-level locations.
- Items can belong to a location at any level. Item counts and item lists of a location include all its sub-locations.
- Items can have several external IDs (`source` + `value`, e.g. "Elektrikář: EL-4821"). Item search covers name, code, serial number, external IDs, manufacturer, model and location names.
- Search must ignore diacritics and case (`unaccent` + `pg_trgm`), sorting uses Czech collation.
- Manufacturer to service provider is many-to-many with a priority (1, 2, 3...). Priority is unique per manufacturer and is saved for the whole list in one transaction.
- Records are never hard-deleted: archive with `archived_at`, restore possible.
- Optimistic locking: updates send `version`; a stale version returns 409 (`conflict`).
- Every entity has an internal UUID `id` that never changes and a human `code` (LOC-004, INV-00042, SUP-001), unique. The `code` will later be the content of QR labels (`/q/<code>`).
- Dates are `date` (no time). Document links accept only https links to drive.google.com or docs.google.com.
- Roles: `read` views everything; `write` also creates and edits; `admin` also manages users and location types. Open question: whether `write` may manage manufacturers, providers and archiving (currently assumed yes).

## UI conventions

- Everything the user sees is Czech. All strings live in the i18n file, never hardcoded in components.
- Formats: date `27. 9. 2026`, Czech plurals (1 položka, 3 položky, 5 položek).
- Follow the UI design: shadcn/ui components, Tailwind, tokens from the design (accent `#2454C7`, neutral gray scale, status colors for overdue service, service within 30 days, expired warranty), system font, 4/8 px grid, radii 6/8/12 px.
- Mobile first. Touch targets at least 44 x 44 px. WCAG 2.2 AA contrast, full keyboard support.
- Every screen has loading (skeleton), empty, "nothing found" and error (with retry) states.
- Every screen has its own URL (deep links, browser back, future QR links). Active tab and search text are in the URL.

## Security

- Secrets only on the API, never in the SPA, never in git. Use Secret Manager in production and an untracked `.env` locally.
- Session cookie: HTTP-only, Secure, SameSite=Lax. SPA and API share one domain, so no CORS.
- Photos: private bucket, upload only via signed URL for one file, max 10 MB, images only. The SPA resizes to max 2048 px before upload, which also strips EXIF/GPS.
- No self-registration. Only invited users can sign in; deactivating a user deletes their sessions.

## Testing

- Unit tests for services with fake repositories (rules, roles, audit, supplier order, cycles in the location tree).
- Integration tests for every API endpoint against a real PostgreSQL (Testcontainers), including 401, 403 and 409 cases. Use `app.request()`, no running server needed.
- Component tests for forms and search; Playwright E2E for the main flows (login, search by external ID, new sub-location, new item with photo, reorder service providers).
- Prefer fakes over mocks. No feature is done without tests for its rules.

## Commands

To be filled in once the project is scaffolded (install, dev, test, lint, typecheck, build, migrate, seed). Keep this section accurate; do not guess commands that do not exist yet.

## Working agreement

- Work in small steps, one module or screen at a time: schema, repository, service with tests, routes with tests, then the UI.
- Before larger changes to the data model or architecture, propose the change first.
- Do not add dependencies without a reason. Keep it simple; this is a small internal app.
- Out of scope for v1 (but keep the design ready for it): QR inventory scanning, service history, e-mail reminders for service and warranty, offline mode, import/export. Do not build these unless asked.
- Code, identifiers and comments in English. UI text in Czech.
