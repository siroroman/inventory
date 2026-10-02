# Správa majetku (Asset Inventory) — Specification

Version 0.3: React SPA + Node API, aligned with the UI design.

Source documents (Slovak, kept as the record of decisions):
- Full spec, architecture, data model, API: https://claude.ai/code/artifact/b68ed72e-4c8a-4409-8e2a-c6b1408414aa
- UI design (mobile 390 px + desktop 1280 px, components and tokens): https://claude.ai/artifact/348Z5z5RWitYajoUzqSoDP

This file is the English working spec for implementation with Claude Code. If it and the Slovak source ever disagree, the Slovak source is authoritative — flag the conflict instead of guessing.

## 1. Overview and goals

A simple installable web app (PWA) for company asset inventory: locations with sub-locations, items with photos and service data, manufacturers, and service providers ranked in the order they should be contacted. UI is Czech only. Up to about 10 users.

Priorities, in order: **simplicity, reliability, security, user friendliness**.

### Scope for v1

- Login by email + password or Google account; roles Admin, Write, Read
- Locations in a hierarchy with an unlimited number of sub-location levels, e.g. *Centrála Praha › Přízemí výroba › 0.19 – Teplá kuchyňa*
- Items: list, diacritics-insensitive search, detail, create, edit, archive
- External IDs on items assigned by suppliers (e.g. a number an electrician assigned to an item); searchable
- Item photos and a link to a documents folder in Google Drive
- Manufacturers and service providers with the order in which to contact them
- Installable PWA, mobile and desktop

### Out of scope for v1, but the architecture accounts for it

QR-code inventory scanning, service/warranty reminders, offline mode, data import/export. (Service history is in: see §3.4 and `service_records`.)

### Working assumptions (confirm in Open Questions)

- Tens of top-level locations, hundreds including sub-locations; hundreds to low thousands of items
- Accounts are created by an admin; no self-registration
- Records are never hard-deleted, only archived
- Item documents stay in Google Drive; the app only links to them. Files that belong to one maintenance event (a report, an invoice, a photo of a protocol) are uploaded to the service record itself (§3.4)

## 2. Users, roles and login

Only invited users get access, and each has exactly one role. **Permissions are enforced exclusively by the backend** — the frontend only hides actions it shouldn't show.

| Action | Read | Write | Admin |
| --- | --- | --- | --- |
| View locations, items, manufacturers, providers | yes | yes | yes |
| Create/edit locations and items, incl. photos | no | yes | yes |
| Manage manufacturers, providers, and service order | no | yes (assumed) | yes |
| Archive and restore records | no | yes (assumed) | yes |
| Manage location types | no | no | yes |
| Invite users, change roles, deactivate accounts | no | no | yes |

### Login

- Login is handled by **Better Auth** in the Node API: email + password and "Sign in with Google". Accounts and sessions live in the same PostgreSQL database; passwords are stored only as hashes.
- Username = email.
- Invitation: an admin enters email, name and role in an "Invite user" dialog. Until the invited person signs in, their status is "Invitation sent · Pending". They receive an email with a link to set a password, or sign in with a Google account using the same address.
- Self-registration is disabled. An uninvited email is rejected with "This account has no access to the app. Contact your administrator."
- The session lives in an HTTP-only cookie and is stored in the DB. Deactivating an account deletes its sessions, so deactivation is effective immediately.
- Forgotten password via a one-time email link. If everyone ends up with a company Google account, passwords and these emails become unnecessary.
- Optional: restrict Google sign-in to the company domain and enable 2FA for admins.

## 3. Screens and behavior

The UI design (link above) has screens 1–11 for both mobile (390 px) and desktop (1280 px). This section describes intended behavior; the design is the visual source of truth.

From the user menu (avatar with initials, top right) you can also reach: Manufacturers & service, Users (admin only), and Sign out. Every screen has its own URL, so browser back, bookmarks, and future QR links all work.

**Navigation map:** Login → Home (3 tabs: Locations, Items, Maintenance) → Location detail (has sub-locations, loops back to itself for nested levels) → Item detail (links to Manufacturer detail, only if the manufacturer has service data) → Manufacturer detail (lists Service providers with priority order) → Service provider detail.

### 3.1 Login

- app icon (clipboard with a check mark) and the name "Správa majetku"; on desktop also a short tagline: "Přehled o lokalitách, vybavení a servisních dodavatelích na jednom místě."
- Fields Email and Password, "Přihlásit se" button, an "nebo" divider, "Přihlásit se přes Google", a "Zapomenuté heslo?" link.
- Errors: "Nesprávný e-mail nebo heslo." and "Tento účet nemá do aplikace přístup. Obraťte se na správce."
- After login, return to the originally requested URL.

### 3.2 Home — Locations, Items and Maintenance tabs

- Top bar with app name and avatar; below it, tabs Locations / Items / Maintenance. Active tab and search text live in the URL.
- On desktop (from 1024 px) Home has a side menu instead of the top bar and the tabs: logo and name, links Locations / Items / Maintenance, and the signed-in user (name, role, sign-out menu) at the bottom. The heading, search and "Add" button share one row above the list. Other screens keep the top bar.
- Heading with a record count, a search field, and an "Add location" / "Add item" button (Write and Admin only).
- **Locations** shows only top-level locations. Mobile: name, type badge, a line like "Praha · 38 items · 4 sub-locations". Desktop: table with Name, Type, City, Item count, Sub-locations.
- A location's item count includes items in all of its sub-locations.
- **Items** search placeholder: "Search by name, ID, serial number, external ID…". Mobile: thumbnail, name, ID with the full location path, manufacturer and model. Desktop: table with Name, ID, Location, Manufacturer & model, Service.
- Status badges: "Service overdue" and "Service due within 30 days".
- Search runs live (300 ms debounce after the last keystroke) and is diacritics- and case-insensitive. Item search covers name, ID, serial number, external IDs, manufacturer, model, and the location names along the full path. Location search (the Locations tab and the location pickers) covers name and ID; several words may be spread over the path, each word in the location or one above it and at least one in the location itself ("zasedačka hradec" finds Zasedačka in Centrála Hradec Králové).
- **Maintenance** lists the service records of all items, newest first. Search placeholder: "Hledat podle názvu, položky, lokality…"; it covers the record title, the item's name and ID, and the location names along the path (words are not split across fields). Mobile: title, "date · item", then the location path. Desktop: table with Title, Date, Item (a link to the item), Location. The "Add record" button (Write and Admin) opens the service record form with a required item search field; an item's own "Add record" keeps the item fixed.
- Lists load in pages of 20 (the API's default page is 50; the SPA asks for 20).
- A "Show archived" checkbox under the search swaps the list for the archived records (`?archived=true` in the URL; archived locations at every level, marked "Archived"). A row opens the detail, where Write and Admin restore it. On the Maintenance tab it lists the archived records (marked "Archived").

### 3.3 Location / sub-location detail

- Breadcrumb at the top with the full path up, e.g. *Centrála Praha › Přízemí výroba*.
- Fields: ID (e.g. LOC-004), Parent location (as a link), Location type (top-level locations only), Address, Note. An empty field shows as "—".
- **Sub-locations (N):** direct children with their item counts, linking to their detail; an "Add sub-location" button.
- **Items in this location (N):** items in this location and all its sub-locations. Each row shows which sub-location it's actually in (desktop: a "Location" column). Show the first few plus a "Show all N items" link (suggested: opens the Items tab pre-filtered to this location).
- Actions for Write and Admin: Edit, Archive.

### 3.4 Item detail

| Group | Field | Behavior |
| --- | --- | --- |
| Basic info | ID | e.g. INV-00042; later the content of the QR label |
| Basic info | External IDs | 0..N entries shaped "Supplier: ID", e.g. "Electrician: EL-4821" |
| Basic info | Name | required |
| Basic info | Location | full path, every level is a link |
| Basic info | Manufacturer | links to manufacturer detail only if it has service providers |
| Basic info | Model, Serial number, Manufacture year | text; year 1950 to current |
| Registration & warranty | Registered on, Warranty until | "Expired" badge after the warranty date |
| Documents | "Open folder in Google Drive" | opens in a new tab |
| Note | free text | |
| Service (last section) | Last service, Next service due, then **Service history (N)** | the two dates stay manual fields of the item; the history lists its service records newest first (title + date, each opens the record), "Add record" for Write and Admin on an active item |

- Photo gallery: horizontally scrollable strip on mobile; main photo + thumbnails side by side on desktop.
- Actions for Write and Admin: Edit, Archive. Photos are added in the edit form, not on the detail screen.

#### Service record detail

Item (link), Date, Title, Service performed by, Responsible person, Description (empty fields show "—"). Actions for Write and Admin on an active record of an active item: Edit, Archive (asks first, then returns to the item). An archived record of an active item offers Write and Admin Restore (no Edit until it is restored); a record of an archived item is shown without actions. Archived records are found with "Show archived" on the Maintenance tab.

**Documents** (last section, "Documents (N)"): the files attached to the record, newest first, each with its name (a link that opens the file), the date it was added and who added it. Allowed: PDF, JPEG/PNG/WebP, Word (.doc, .docx) and Excel (.xls, .xlsx), up to 20 MB each. Write and Admin, on an active record of an active item, can "Upload file" (several at once; on a computer the file dialog, on a phone the system sheet with the gallery, the files app and the camera) and, on a touch screen, "Take photo" (straight to the camera). After picking, a dialog lists the files with an editable name each (the file name without its extension, "Foto 2. 10. 2026" for a camera shot); a file that fails stays in the dialog with the reason. Pictures of any format are shrunk in the browser to a JPEG of at most 2048 px, which also removes the GPS position. Every document has a download button (the file is saved under the document's name); PDFs and pictures also have a view button that opens them in a dialog with the browser's own PDF viewer (on a touch screen the name link opens the browser's viewer in a new tab instead; Word and Excel files are only downloaded). A document can be renamed and deleted (asks first); archived records and records of archived items still list their documents but cannot change them.

### 3.5 Manufacturer detail

- Name, Note, and a "Service providers" section with the text: "Contact suppliers in this order. If one can't help, move to the next."
- Provider cards ranked 1, 2, 3…: name, contact person with phone, and Call / Email / Web icon actions.
- Write and Admin reorder with up/down arrows directly on the card.

### 3.6 Service provider detail

ID (e.g. SUP-001), Name, Contact person, Phone, Email, Web, Note, and the brands it services, each showing this provider's priority for that brand. Action: Edit.

### 3.7 Forms

- **Location:** Parent location (optional; empty = top level), Name, Location type (top level only: Centrála/HQ, Prodejna/Store, Provozovna/Site, Sklad/Warehouse; extensible list), Address (single line), Note.
- **Item:** sections Basic info, Registration/warranty/service, Photos, Note. Location is optional (an item can be added before anyone knows where it is) and is chosen via search, including sub-locations shown with their full path; each match is followed by the sub-locations below it; tapping the chosen location searches again. External IDs are a repeatable Supplier + Their ID pair with an "Add external ID" button. Photos: "Take photo" on mobile, "Upload" or drag-and-drop on desktop.
- **To add beyond the current design:** a Documents field (Google Drive folder link) in the item form's Basic info section.
- **Service record:** the item (read-only), Date (default today), Title (required), Service performed by and Responsible person (both free text, not links to registered providers or users), Description. Opened from the item's "Add record" button and from the record's Edit.
- **Service provider:** Name, Contact person, Phone, Email, Web, Brands serviced (addable tags), Note. Per-brand priority is set from the manufacturer detail screen.
- **Manufacturer:** no standalone form in the current design. Proposal: a new manufacturer is created by typing a new name in the Manufacturer or Brands field; its note is edited from its detail page.
- Field-level errors (e.g. "Enter a valid email."), Cancel and Save buttons. Warn on leaving an unsaved form; on a concurrent edit, show a conflict message instead of silently overwriting.

### 3.8 Users (Admin)

- List with initials, name, email, role; a not-yet-signed-in invitee shows "Invitation sent · Pending".
- "Invite user" dialog: Email, Name, Role (Read, Write, Admin), Cancel / Send invitation.
- Role change and deactivation are not yet in the design — suggested: a menu on the user's row.

### 3.9 States and shared rules

- Loading (skeleton); empty list "Nothing here yet" with an add button; "No results" with a tip to adjust the search; error "Something went wrong" with a "Try again" button; a "Saved" toast.
- Locale cs-CZ: date format "27. 9. 2026", Czech plural forms ("1 položka, 3 položky, 5 položek"), Czech alphabetical sort order.
- Touch targets at least 44×44 px, WCAG 2.2 AA contrast, full keyboard support.

## 4. Data model

Data is relational, hence PostgreSQL. Every entity has an internal `id` (UUID, never changes), and locations, items and providers also have a human `code` per the UI design: LOC-004, INV-00042, SUP-001. The code is unique and will later be the content of a QR label.

| Table | Key columns | Relationships & rules |
| --- | --- | --- |
| `location_types` | code, name, sort_order | HQ, Store, Site, Warehouse; a new type is a new row |
| `locations` | code, name, parent_id, location_type_id, address, note | tree via `parent_id`, unlimited depth; type required only for a location with no parent; address is a single text line |
| `items` | code, name, location_id, manufacturer_id, model, serial_number, manufacture_year, registered_on, warranty_until, last_service_on, next_service_on, documents_url, note | N:1 location at any level (optional), N:1 manufacturer (optional) |
| `item_external_ids` | item_id, source, value | N:1 item; `source` is free text (e.g. "Electrician"), `value` is searchable the same way as the internal ID; (source, value) is unique across all items, archived ones included, ignoring case |
| `item_photos` | item_id, storage_key, content_type, width, height, sort_order | N:1 item; the file lives in Cloud Storage |
| `service_records` | item_id, performed_on, title, performed_by, responsible_person, description | N:1 item; free text for who did it (no link to providers or users); archivable and versioned like the other records, never deleted |
| `service_record_documents` | service_record_id, name, storage_key, content_type, size_bytes | N:1 service record; the file lives in Cloud Storage; `created_by` is the uploader; versioned (rename); deleted for real, with the file, and the audit log keeps the trace |
| `manufacturers` | name (unique), note | M:N service providers |
| `service_providers` | code, name, contact_person, phone, email, web, note | M:N manufacturers |
| `manufacturer_service_providers` | manufacturer_id, service_provider_id, priority | unique pairs (manufacturer, provider) and (manufacturer, priority); the whole order is saved in one transaction |
| `user`, `session`, `account`, `verification` | Better Auth tables; `user` extended with role and is_active | author of changes in every table |
| `audit_log` | occurred_at, user_id, entity_type, entity_id, action, changes (jsonb) | written by the service layer in the same transaction as every change |

**Common columns:** created_at, created_by, updated_at, updated_by, archived_at, version. Archiving sets `archived_at`; a record can be restored. `version` guards against overwriting a concurrent edit.

**Location hierarchy**

- Both the path up (breadcrumb) and item counts across a whole subtree are computed with a recursive query (`WITH RECURSIVE`). At hundreds of locations there's no need to store the path separately.
- A location must never become its own ancestor; the server checks this on every parent change.
- Decided: a location with active sub-locations or items can be archived. They drop out of lists and counts with it (an archived sub-location hides everything below it) and come back when the location is restored; the confirm dialog says how many are affected.

**Other rules**

- Search uses the `unaccent` and `pg_trgm` extensions with a GIN index over normalized item text, including external IDs; sorting uses ICU Czech collation.
- Dates are the `date` type (no time); manufacture year is `smallint` with a range check.
- `documents_url` only accepts an https link to drive.google.com or docs.google.com.
- Schema changes only go through versioned migrations, never manual production edits.

## 5. Architecture

The browser loads a React SPA and calls a REST API on the same domain. **One Docker container running Node serves both `/api/*` and the SPA's static files**, so there's no CORS to configure and the session cookie works with no extra setup. Photos go directly between the browser and Cloud Storage via short-lived signed URLs.

```
┌──────────────┐        ┌───────────────────────────┐        ┌─────────────┐
│ Browser (PWA)│──HTTPS→│ One Docker container       │──SQL──→│ PostgreSQL  │
│ React SPA    │←───────│  /api/*  → Node API (Hono) │        │ (Cloud SQL) │
└──────────────┘        │  /*      → static SPA files│        └─────────────┘
       │                └───────────────────────────┘
       └─────────signed URL─────────→ Cloud Storage (photos, private bucket)
```

### 5.1 API: modular monolith

- One module per domain: `locations`, `items`, `photos`, `service-records`, `manufacturers`, `service-providers`, `users`, `audit`; later `inventory`.
- Each module has three layers, with dependencies pointing down only:
  - **routes** — Hono + `@hono/zod-openapi`: input validation, OpenAPI description, error mapping
  - **service** — business rules, role checks, audit, transactions; knows nothing about HTTP
  - **repository** — SQL via Drizzle, including recursive queries over the location tree
- Dependencies are passed through factory functions, e.g. `createItemService({ itemRepo, audit, clock })` — no global state.
- Middleware loads the Better Auth session and puts the user + role into the request context. A route calls `requireRole('write')`, and the service checks the role again independently.

### 5.2 Frontend: React SPA

- Vite + React + TypeScript, folders by feature (`features/locations`, `features/items`), not by file type.
- TanStack Router handles routing and URL params; TanStack Query handles server data and caching. No global store needed.
- The API client is Hono RPC (`hc`) with types coming straight from the API — no code generation step.
- A screen = a data hook + a presentational component built from shadcn/ui, following the UI design.

### 5.3 Shared package

`packages/shared` holds Zod schemas, roles and types. The same schema validates a form in the browser and a request in the API, and also generates the OpenAPI spec for a future native app.

### 5.4 Repository layout

```
apps/api/          Hono API, Better Auth, Drizzle schema, migrations, seed
apps/web/          React SPA (PWA)
packages/shared/   Zod schemas, roles, types
Dockerfile         multi-stage build: web + api into one image
```

pnpm workspaces monorepo. API and SPA are developed and tested independently, deployed together. If needed later, the SPA can move to a CDN without code changes.

## 6. Tech stack

One TypeScript monorepo, deployed as a single Docker container on Cloud Run (region: europe-west3 / Frankfurt), with Cloud SQL and Cloud Storage. The same image runs on any cloud with Docker and PostgreSQL.

| Layer | Choice | Why |
| --- | --- | --- |
| FE framework | React + TypeScript + Vite | most widely used FE stack, fast builds |
| FE routing & data | TanStack Router + TanStack Query | typed URLs, caching and loading states with no custom code |
| UI | Tailwind CSS + shadcn/ui (Radix), Lucide icons | matches the UI design, accessible components |
| Forms | React Hook Form + Zod | same schemas as the API |
| Text | i18next, locale `cs` | all strings in `cs.json` |
| PWA | vite-plugin-pwa (Workbox) | installable, caching, foundation for an offline scanner later |
| API runtime | Node.js 24 LTS + TypeScript | one language with the FE, fast container start |
| API framework | Hono + `@hono/zod-openapi` | small and simple; validation, OpenAPI and FE types from one schema |
| Database | Cloud SQL for PostgreSQL 17+ | relational data, recursive queries over the location tree, backups + PITR |
| DB access | Drizzle ORM + drizzle-kit | typed SQL, versioned migrations |
| Login | Better Auth in the API (email+password, Google) | accounts and sessions in the same DB. Auth.js is now maintenance-only and its team recommends Better Auth ([source](https://better-auth.com/blog/authjs-joins-better-auth)) |
| Files | Cloud Storage, private bucket | photos and service record documents via short-lived signed URLs |
| Email | a transactional service (e.g. Resend, Postmark) or the company's Google Workspace SMTP | invitations and password resets |
| Runtime | Docker image on Cloud Run | one container for API and SPA, scales to zero |
| CI/CD | GitHub Actions + Workload Identity Federation | keyless deploys, tests before every deploy |
| Monitoring | Cloud Logging, Error Reporting, Uptime check | failures and outages reported by email |

### Why React SPA + Node API (not a fullstack framework)

The API is standalone from day one, so a future scanner or native app can use it unchanged. The SPA naturally supports an offline mode if the client wants one later. React without server components has a simpler mental model than a metaframework. The cost is a bit more code: separate API routes and a client.

### Estimated monthly cost

At single-digit users, the database is almost the entire cost. Figures are approximate, based on `us-central1` pricing; EU is somewhat higher.

| Item | Estimated / month | Note |
| --- | --- | --- |
| Cloud SQL, shared-core `db-f1-micro` | ~$7–10 | no SLA, fine to start |
| Cloud SQL, 1 dedicated vCPU + 3.75 GB RAM | ~$50 | computed from per-vCPU/GB rates; SLA-covered |
| SSD 10 GB + backups | ~$2–4 | SSD ~$0.22/GB, backups ~$0.11/GB |
| Cloud Run, Cloud Storage, email | $0 to a few dollars | mostly within free tiers at this load |

Recommendation: start on `db-f1-micro` with daily backups and PITR, and decide before go-live whether an SLA is needed.

Sources: [Cloud SQL pricing breakdown, May 2026](https://securityboulevard.com/2026/05/google-cloud-sql-pricing-2026-instance-costs-storage-and-what-the-calculator-hides/); verify against the [official Cloud SQL pricing page](https://cloud.google.com/sql/pricing) for the chosen region before deciding.

## 7. API design

REST API under the `/api/v1` prefix, JSON, with an OpenAPI description at `/api/v1/openapi.json`. Rules that apply to every endpoint:

- Dates in ISO 8601 (`2026-09-27`). Errors in RFC 9457 (`problem+json`) with a machine-readable `code`; the FE picks the Czech text based on the code.
- Lists: `?q=` for search, `?limit=50&cursor=` for pagination, filters as query parameters.
- Updates via `PATCH` with a `version` field. If the record changed in the meantime, the API returns 409.
- Archiving via `POST /…/{id}/archive` and `/restore`, never `DELETE`.
- Photos in a detail response and documents in a document list carry a read-signed URL valid for 15 minutes.

| Method & path | Purpose | Minimum role |
| --- | --- | --- |
| `GET /me` | current user and role | Read |
| `GET /locations?parentId=` | direct sub-locations; no param = top-level locations; search via `q` (every level; `withSubLocations=true` adds everything below each match, ordered by path); `archived=true` = the archived ones at every level | Read |
| `GET /locations/{id}` | detail with path up, sub-locations, item count across the whole subtree | Read |
| `GET /locations/{id}/items` | items in this location, including all sub-locations | Read |
| `POST /locations`, `PATCH /locations/{id}` | create, edit incl. changing the parent | Write |
| `POST /locations/{id}/archive`, `/restore` | archive, restore | Write |
| `GET /location-types` | location types | Read |
| `POST /location-types`, `PATCH /location-types/{id}` | manage types | Admin |
| `GET /items` | list, search incl. external IDs, filter by location/manufacturer; `archived=true` = the archived items | Read |
| `GET /items/{id}` | detail with location path, external IDs, photos, manufacturer | Read |
| `POST /items`, `PATCH /items/{id}` | create, edit incl. external IDs | Write |
| `POST /items/{id}/archive`, `/restore` | archive, restore | Write |
| `POST /items/{id}/photos/upload-url`, `POST /items/{id}/photos` | signed upload URL, confirm uploaded photo | Write |
| `PATCH /items/{id}/photos/order`, `DELETE /items/{id}/photos/{photoId}` | reorder / remove a photo | Write |
| `GET /service-records/{id}/documents` | the record's documents, newest first, with the uploader's name, a read URL (opens in the browser) and a download URL (saves the file); archived records too | Read |
| `POST /service-records/{id}/documents/upload-url`, `POST /service-records/{id}/documents` | signed upload URL for one file of the declared type and size (PDF, image, Word, Excel; up to 20 MB), confirm the uploaded file under a name | Write |
| `PATCH /service-records/{id}/documents/{documentId}`, `DELETE …` | rename (with `version`), delete a document and its file; only under an active record of an active item | Write |
| `GET /service-records` | service records of all items, newest first, with the item and its location path; `?q=` (title, item name and ID, location names), `?archived=true` for the archived records | Read |
| `GET /items/{id}/service-records` | the item's active service records, newest first (`performed_on` desc, paged by date + id); an archived item lists its records too | Read |
| `POST /items/{id}/service-records` | add a record to an active item | Write |
| `GET /service-records/{id}` | a record with its item (archived ones too) | Read |
| `PATCH /service-records/{id}` | edit a record of an active item | Write |
| `POST /service-records/{id}/archive`, `/restore` | archive, restore | Write |
| `GET /manufacturers`, `GET /manufacturers/{id}` | list, detail with ranked providers | Read |
| `POST /manufacturers`, `PATCH /manufacturers/{id}` | create, edit | Write |
| `PUT /manufacturers/{id}/service-providers` | send the whole new order at once, on every arrow click | Write |
| `GET /service-providers`, `GET /service-providers/{id}` | list, detail with brands | Read |
| `POST /service-providers`, `PATCH /service-providers/{id}` | create, edit | Write |
| `POST /service-providers/{id}/archive`, `/restore` | archive, restore | Write |
| `PUT /service-providers/{id}/manufacturers` | send the whole set of brands the provider services with the provider's `version`; a new brand ranks it last, a change bumps the version | Write |
| `GET /users`, `POST /users`, `PATCH /users/{id}` | list, invite, role, deactivate | Admin |
| `GET /audit?entityType=&entityId=` | change history of a record | Admin |
| `/api/auth/*` | Better Auth: login, Google, password reset | none |
| `GET /health` | liveness check | none |

## 8. Security, operations and testing

Security rests on three rules: access only for invitees, permissions enforced solely in the API, and only one container reachable from the internet.

### 8.1 Security

- Every endpoint checks session and role in both middleware and the service layer. Hiding a button in the SPA is not protection.
- Session cookie is HTTP-only, Secure, SameSite=Lax. The SPA and API share one domain, and Better Auth accepts requests only from it.
- No secret ever reaches the SPA. Only the API holds keys, kept in Secret Manager.
- Cloud SQL with a private IP; Cloud Run reaches it via Direct VPC egress. The DB is not reachable from the internet, and there's no public IPv4 fee.
- Cloud Run runs under its own service account with minimal permissions: connect to the DB, write to one bucket, read specific secrets.
- The bucket is private. Uploads only via a signed URL scoped to one file, type and size: photos max 10 MB, images only; service record documents max 20 MB, PDF, images, Word and Excel. The SPA resizes every picture to max 2048 px before upload, which also strips EXIF/GPS location.
- Security headers set by Hono middleware: CSP, HSTS, X-Content-Type-Options, Referrer-Policy.
- The audit log records every change with its author and time. Data stays in the EU region.

### 8.2 Operations and reliability

- Cloud SQL: daily automatic backup and point-in-time recovery for 7 days. Test a backup restore before go-live.
- Cloud Storage: soft delete, so an accidentally deleted photo can be recovered.
- Migrations run as a Cloud Run job before a new version deploys. On failure, the deploy stops and the old version keeps running.
- Cloud Run keeps previous revisions; rollback is one command.
- Uptime check on `/api/v1/health`, with an email alert on an outage or an error spike.
- Dependencies are updated regularly; security patches immediately.
- Local environment: Docker Compose with PostgreSQL and a Cloud Storage emulator; the Vite dev server proxies `/api` to the local API. No staging environment until there's a reason for one.

### 8.3 Testing

| Level | Tool | Covers |
| --- | --- | --- |
| Unit | Vitest | services with fake repositories: business rules, roles, audit, provider ordering, cycles in the location tree |
| API integration | Vitest + Testcontainers (PostgreSQL), `app.request()` | every endpoint against a real DB, incl. 401/403/409, without a running server |
| FE component | Vitest + Testing Library + MSW | screens and forms without a real API |
| E2E | Playwright | login, search by external ID, new sub-location, new item with a photo, reordering service providers |
| Contract | TypeScript + the Hono RPC client | an API change that breaks the SPA fails at typecheck |

CI gate before every deploy: lint, typecheck, all tests, build. Only a green build from the main branch goes to production.

## 9. Extensibility: QR inventory

QR inventory is not planned for v1, but v1 already has everything it will build on: stable codes, deep links, and a modular API.

- **What the QR code will contain:** a URL like `https://<domain>/q/INV-00042`. A phone camera opens it even without the app's scanner, and the in-app scanner reads the same URL. Locations get labels the same way (`/q/LOC-004`).
- **Already in v1:** unique human-readable codes, screens with their own URLs, returning to the original URL after login, and a standalone REST API the scanner will use unchanged.
- **New `inventory` module:** tables `inventory_sessions` (location, who, start, end, status) and `inventory_scans` (item, time, who, result: found / missing / at a different location). A location's inventory run includes all its sub-locations. Existing modules don't change.
- **Scanning in the PWA:** a scanner screen in the SPA, camera via `getUserMedia`, the BarcodeDetector API where available, otherwise the zxing library.
- **Offline inventory:** the service worker already caches the SPA; scans are stored in IndexedDB and sent to the API once back online.
- **Labels:** an endpoint that generates a PDF of labels for a location and its sub-locations, or for a selection of items.
- **Native app:** reuses the same `/api/v1`. A Swift or KMP client is generated from the OpenAPI spec, and login uses a bearer token instead of a cookie.
- **Item status:** a `status` column (Active, Decommissioned, Lost) is added via migration once the inventory feature needs it.

## 10. Iteration plan

Build the API first, with tests, then the SPA on top of finished modules. The UI design is complete, so the SPA can start as soon as the first API module is ready.

1. **Foundation:** answer the Open Questions, set up the GCP project and billing, monorepo, CI, Dockerfile, local environment.
   - Done when `/api/v1/health` runs on Cloud Run from CI.
2. **API:** schema and migrations, Better Auth and roles, then modules in this order: locations (tree, cycles, counts), items with external IDs and search, manufacturers and providers, photos, users; plus audit, OpenAPI, seed data taken from the UI design.
   - Done when every endpoint has an integration test covering roles and runs in production with backups.
3. **SPA:** scaffold with tokens from the UI design, login, Home, detail screens, forms, Users, screen states, PWA. Starts with locations once that API module is ready.
   - Done when the main-flow E2E tests pass on both mobile and desktop.
4. **Go-live:** import existing inventory data (if any), invite users, test a backup restore.
5. **Future versions:** QR inventory, service/warranty reminders. (Service history is done; viewing and restoring archived records comes next.)

## 11. UI design summary

The finished design ([Evidence majetku — UI design](https://claude.ai/artifact/348Z5z5RWitYajoUzqSoDP)) is the source of truth for visuals. It has 26 frames: screens 1–9 for mobile and desktop, service-provider detail, service record detail and form (10, 11), users, states, and a components/tokens overview for React, Tailwind and shadcn/ui.

| Token | Value |
| --- | --- |
| Accent color | `#2454C7` (adjustable in the design) |
| Neutral scale | gray from 50 `#F7F7F8` to 900 `#141417` |
| Status colors | overdue / expired warranty: `#B3261E` on `#FBEAE9`; due within 30 days: `#9A5B00` on `#FDF0DC` |
| Font | system font stack (-apple-system, Segoe UI, Roboto) |
| Type scale | 20/600 screen title, 17/600 top bar, 15/600 names & buttons, 14/400 body, 13/700 uppercase section heading, 12/400 captions |
| Spacing | 4/8 px grid: 4, 8, 12, 16, 24, 32 |
| Radius | 6, 8, 12 px; badges as pills |
| Touch target | min. 44×44 px; button 44 px, small button 36 px |

**What the design added beyond the original brief:** sub-locations with breadcrumb navigation, external item IDs, the Site and Warehouse location types, a single-line address field, arrow-based provider reordering, photos in the form instead of on the detail screen, and a "Pending" status for invited users.

**Still to add to the design:**
- a Documents field (Google Drive link) in the item form
- role change and user deactivation
- creating/editing a manufacturer
- a placeholder in the top bar for the future "Scan QR" action
- dark mode, if the client wants it

## 12. Open questions

Questions 1–7 change the design the most; the rest can be settled during development. Already decided: the React SPA + Node API stack in TypeScript, and a single-line address field per the UI design.

1. **Login:** Does the company use Google Workspace, and does every user have a company Google account? If so, Google sign-in restricted to the domain is enough, and passwords plus password-reset emails become unnecessary.
2. **Username:** Is it fine for the login name to be the email address?
3. **Permissions:** May the Write role manage manufacturers, providers, and service order, and archive records — or only Admin?
4. **Record IDs:** Do you have existing inventory numbers (what format), or should the app generate them (LOC-001, INV-00001, SUP-001)? Can an ID change later?
5. **Starting data:** Is there an existing spreadsheet to import? Roughly how many locations, sub-locations, and items?
6. **Sub-locations:** Can an item be assigned to any level, or only the lowest one? Does a sub-location inherit its parent's address? ~~What should happen when archiving a location that still has sub-locations or items?~~ *Decided:* allowed, with a warning (see §4).
7. **External IDs:** Is free text in the Supplier field enough, or should it link to a registered service provider? ~~Must an external ID be unique?~~ *Decided:* unique per supplier — "Elektrikář: EL-4821" can exist only once across all items (archived included, case-insensitive); the same ID under another supplier is allowed. The supplier-link part is still open.
8. ~~**Categories:** Should an item have a category (machine, equipment, IT…) with a list filter?~~ *Decided:* later, not in v1.
9. **Service:** ~~Are two dates enough, or do you want a full service history (date, provider, description, report)?~~ *Decided:* a history of records (date, title, who performed it and the responsible person as free text, description) on each item; the two item dates stay manual and are not derived from the records. *Decided:* a record can hold uploaded documents (§3.4). Still open: whether the next check date should be computed from an interval.
10. **Reminders:** Do you want email alerts or a dashboard of items with service or warranty coming due?
11. **Documents:** Is a Google Drive folder link enough, or should files be shown inside the app? The latter needs Drive API access and access to the company's Drive.
12. **Photos:** Roughly how many photos per item?
13. **Offline:** Will users work without signal (warehouses, basements)? If so, we'll add an offline mode to the SPA, at least for the scanner.
14. **Location moves:** Should the item detail show a history of location moves? The audit log will capture it either way.
15. **Budget & SLA:** Is `db-f1-micro` without an SLA enough, or should we go straight to a dedicated vCPU with an SLA?
16. **Operations:** Who will own the GCP project and billing, what domain (e.g. `majetek.firma.cz`), what address will invitations be sent from, and who maintains the app after launch?
17. **Design:** Do you have company colors and a logo, or does the accent stay `#2454C7`? Do you want dark mode?
