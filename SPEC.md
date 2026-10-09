# Správa majetku (Asset Inventory) — Specification

Version 0.4: React SPA + Node API, aligned with the UI design; adds inventory runs and labels (§9).

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
- Inventory runs (Inventura) with QR labels, scanning on phones, the Nezvěstná status, a printable protocol and a CSV export (§9)
- Installable PWA, mobile and desktop

### Out of scope for v1, but the architecture accounts for it

Service/warranty reminders, offline mode (inventory scanning is online only), general data import/export (the real inventory was imported once; a finished inventory has its own CSV). Service history is in: see §3.4 and `service_records`.

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
| Take inventory: start, check, move items, finish, cancel; mark a missing item found (§9) | no | yes | yes |
| View inventory runs and results, print protocols and labels, export CSV, quick scan (§9) | yes | yes | yes |
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

The UI design (link above) has screens 1–11 for both mobile (390 px) and desktop (1280 px), and frames 17–27 for inventory and labels (§9). This section describes intended behavior; the design is the visual source of truth.

From the user menu (avatar with initials, top right) you can also reach: Users (admin only) and Sign out. Every screen has its own URL, so browser back, bookmarks, and future QR links all work.

**Navigation map:** Login → Home (5 tabs: Locations, Items, Maintenance, Suppliers, Inventory) → Location detail (has sub-locations, loops back to itself for nested levels) → Item detail (links to Manufacturer detail and lists its service providers) → Manufacturer detail (lists Service providers with priority order) → Service provider detail (links to the Manufacturers it services) → Service provider form. Inventory: Inventory tab → Start / Run overview → Location checklist → Scanner; Finish → Result → Protocol (§9.4). On touch devices, Home also offers a quick scan that opens an item (§9.4.11).

### 3.1 Login

- app icon (clipboard with a check mark) and the name "Správa majetku"; on desktop also a short tagline: "Přehled o lokalitách, vybavení a servisních dodavatelích na jednom místě."
- Fields Email and Password, "Přihlásit se" button, an "nebo" divider, "Přihlásit se přes Google", a "Zapomenuté heslo?" link.
- Errors: "Nesprávný e-mail nebo heslo." and "Tento účet nemá do aplikace přístup. Obraťte se na správce."
- After login, return to the originally requested URL.

### 3.2 Home — Locations, Items, Maintenance, Suppliers and Inventory tabs

- Top bar with app name and avatar; below it, tabs Locations / Items / Maintenance / Suppliers / Inventory (the tab bar scrolls sideways on phones). Active tab and search text live in the URL. On touch devices the top bar also has a scan icon for the quick scan (§9.4.11).
- On desktop (from 1024 px) Home has a side menu instead of the top bar and the tabs: logo and name, links Locations / Items / Maintenance / Suppliers / Inventory, and the signed-in user (name, role, sign-out menu) at the bottom. The heading, search and "Add" button share one row above the list. Other screens keep the top bar.
- **Inventory** lists the runs in progress, then the finished and cancelled ones (§9.4.1).
- Heading with a record count, a search field, and an "Add location" / "Add item" button (Write and Admin only).
- **Locations** shows only top-level locations. Mobile: name, type badge, a line like "Praha · 38 items · 4 sub-locations". Desktop: table with Name, Type, City, Item count, Sub-locations.
- A location's item count includes items in all of its sub-locations.
- **Items** search placeholder: "Search by name, ID, serial number, external ID…". Mobile: thumbnail, name, ID with the full location path, manufacturer and model. Desktop: table with Name, ID, Location, Manufacturer & model, Service.
- Status badges: "Service overdue" and "Service due within 30 days".
- Missing items carry a "Nezvěstná" badge; the Items tab has a "Jen nezvěstné" filter and a selection mode for printing labels (§9.4.10, §9.4.12).
- Search runs live (300 ms debounce after the last keystroke) and is diacritics- and case-insensitive. Item search covers name, ID, serial number, external IDs, manufacturer, model, and the location names along the full path. Location search (the Locations tab and the location pickers) covers name and ID; several words may be spread over the path, each word in the location or one above it and at least one in the location itself ("zasedačka hradec" finds Zasedačka in Centrála Hradec Králové).
- **Maintenance** lists the service records of all items, newest first. Search placeholder: "Hledat podle názvu, položky, lokality…"; it covers the record title, the item's name and ID, and the location names along the path (words are not split across fields). Mobile: title, "date · item", then the location path. Desktop: table with Title, Date, Item (a link to the item), Location. The "Add record" button (Write and Admin) opens the service record form with a required item search field; an item's own "Add record" keeps the item fixed.
- **Suppliers** (the service providers) lists them by name. Search placeholder: "Hledat podle názvu, ID, telefonu, značky…"; it covers the name, the SUP code, the phone number (with or without the spaces it is written with) and the names of the brands the supplier services (so a brand finds the suppliers to call for it). Mobile: name, then "SUP-001 · phone". Desktop: table with Name, ID, Phone. The "Add supplier" button (Write and Admin) opens the supplier form.
- Lists load in pages of 20 (the API's default page is 50; the SPA asks for 20).
- A "Show archived" checkbox under the search swaps the list for the archived records (`?archived=true` in the URL; archived locations at every level, marked "Archived"). A row opens the detail, where Write and Admin restore it. On the Maintenance tab it lists the archived records and on the Suppliers tab the archived suppliers (marked "Archived").

### 3.3 Location / sub-location detail

- Breadcrumb at the top with the full path up, e.g. *Centrála Praha › Přízemí výroba*.
- Fields: ID (e.g. LOC-004), Parent location (as a link), Location type (top-level locations only), Address, Note. An empty field shows as "—".
- **Sub-locations (N):** direct children with their item counts, linking to their detail; an "Add sub-location" button.
- **Items in this location (N):** items in this location and all its sub-locations. Each row shows which sub-location it's actually in (desktop: a "Location" column). Show the first few plus a "Show all N items" link (suggested: opens the Items tab pre-filtered to this location).
- **Inventory:** a "Historie inventur" row (a run in progress, the last finished one) that opens the location's inventory history (§9.4.10). An inventory is started only from the Inventory tab.
- Actions for Write and Admin: Edit, Archive.

### 3.4 Item detail

| Group | Field | Behavior |
| --- | --- | --- |
| Basic info | ID | e.g. INV-00042; later the content of the QR label |
| Basic info | External IDs | 0..N entries shaped "Supplier: ID", e.g. "Electrician: EL-4821" |
| Basic info | Name | required |
| Basic info | Location | full path, every level is a link |
| Basic info | Manufacturer | links to the manufacturer detail |
| Basic info | Model, Serial number, Manufacture year | text; year 1950 to current |
| Registration & warranty | Registered on, Purchase price, Warranty until | price in CZK with at most two decimals (`144 902 Kč`), visible to every role; "Expired" badge after the warranty date |
| Documents | "Open folder in Google Drive" | opens in a new tab |
| Note | free text | |
| Inventory | "Historie inventur" row with the last check; when missing, a "Nezvěstná" badge under the title and "Označit jako nalezenou" for Write and Admin | see §9.4.10 |
| Service (last section) | Last service, Next service due, then **Service providers**, then **Service history (N)** | the two dates stay manual fields of the item; the providers are the manufacturer's service providers in contact order (numbered cards with contact person, phone and Call / Email / Web buttons, read only; shown when the item has a manufacturer); the history lists its service records newest first (title + date, each opens the record), "Add record" for Write and Admin on an active item |

- Photo gallery: horizontally scrollable strip on mobile; main photo + thumbnails side by side on desktop.
- Actions for Write and Admin: Edit, Archive. Photos are added in the edit form, not on the detail screen.

#### Service record detail

Item (link), Date, Title, Service performed by, Responsible person, Description (empty fields show "—"). A text button above the title, labelled with the item's name (long names are cut with an ellipsis), for every role and state, returns to the item. Actions for Write and Admin on an active record of an active item: Edit, Archive (asks first, then returns to the item). An archived record of an active item offers Write and Admin Restore (no Edit until it is restored); a record of an archived item is shown without actions. Archived records are found with "Show archived" on the Maintenance tab.

**Documents** (last section, "Documents (N)"): the files attached to the record, newest first, each with its name (a link that opens the file), the date it was added and who added it. Allowed: PDF, JPEG/PNG/WebP, Word (.doc, .docx) and Excel (.xls, .xlsx), up to 20 MB each. Write and Admin, on an active record of an active item, can "Upload file" (several at once; on a computer the file dialog, on a phone the system sheet with the gallery, the files app and the camera) and, on a touch screen, "Take photo" (straight to the camera). After picking, a dialog lists the files with an editable name each (the file name without its extension, "Foto 2. 10. 2026" for a camera shot); a file that fails stays in the dialog with the reason. Pictures of any format are shrunk in the browser to a JPEG of at most 2048 px, which also removes the GPS position. Every document has a download button (the file is saved under the document's name); PDFs and pictures also have a view button that opens them in a dialog with the browser's own PDF viewer (clicking the name does the same; on a touch screen a PDF opens in the browser's own viewer in a new tab instead, while a picture still opens in the dialog; Word and Excel files are only downloaded). A document can be renamed and deleted (asks first); archived records and records of archived items still list their documents but cannot change them.

### 3.5 Manufacturer detail

- A back button (to where the user came from; to the Suppliers tab on a deep link), the name, Note, and a "Service providers" section with the text: "Contact suppliers in this order. If one can't help, move to the next."
- Provider cards ranked 1, 2, 3…: name (a link to the supplier), contact person with phone, and Call / Email / Web icon actions for what is known; an archived supplier that is still ranked is marked "Archived". One card under another at every width.
- Write and Admin reorder by dragging a card by its handle (mouse or finger; on the keyboard Space picks the card up, the arrow keys move it, Space drops it and Escape cancels), on an active manufacturer with two or more providers: the new order shows at once and is saved as a whole; a failure puts the old order back and shows the error. A card dropped where it was, or a cancelled drag, saves nothing.
- A manufacturer without providers says so; Write and Admin are told the providers are added in the supplier form. Creating and editing a manufacturer has no screen of its own yet (see 3.7).

### 3.6 Service provider detail

- A back link to the Suppliers tab, the name, and the fields ID (e.g. SUP-001), Contact person, Phone (a call link), Email (a mailto link), Web (opens in a new tab), Note (empty fields show "—").
- **Brands serviced:** each brand (a link to its detail) with this provider's priority for it; an archived brand is marked.
- Actions for Write and Admin: Edit, Archive (asks first; the supplier stays ranked, marked "Archived", in the contact orders it was in). An archived supplier offers Restore instead of Edit and Archive.

### 3.7 Forms

- **Location:** Parent location (optional; empty = top level), Name, Location type (top level only: Centrála/HQ, Prodejna/Store, Provozovna/Site, Sklad/Warehouse; extensible list), Address (single line), Note.
- **Item:** sections Basic info, Registration/warranty/service, Photos, Note. Location is optional (an item can be added before anyone knows where it is) and is chosen via search, including sub-locations shown with their full path; each match is followed by the sub-locations below it; tapping the chosen location searches again. External IDs are a repeatable Supplier + Their ID pair with an "Add external ID" button. Photos: "Take photo" on mobile, "Upload" or drag-and-drop on desktop.
- **To add beyond the current design:** a Documents field (Google Drive folder link) in the item form's Basic info section.
- **Service record:** the item (read-only), Date (default today), Title (required), Service performed by and Responsible person (both free text, not links to registered providers or users), Description. Opened from the item's "Add record" button and from the record's Edit.
- **Service provider:** Name, Contact person, Phone, Email, Web, Brands serviced (addable tags), Note. Brands are added with a search that can also create a new brand from the typed name; a new supplier is added last in that brand's contact order. The contact data and the brands are saved in one request. The email must have a dot after the @ (stricter than the API); a web address without a scheme gets https. Per-brand priority is set from the manufacturer detail screen.
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
| `items` | code, name, location_id, manufacturer_id, model, serial_number, manufacture_year, registered_on, purchase_price, warranty_until, last_service_on, next_service_on, documents_url, note, missing_since | N:1 location at any level (optional), N:1 manufacturer (optional); `missing_since` null = not missing (§9.5) |
| `item_external_ids` | item_id, source, value | N:1 item; `source` is free text (e.g. "Electrician"), `value` is searchable the same way as the internal ID; (source, value) is unique across all items, archived ones included, ignoring case |
| `item_photos` | item_id, storage_key, content_type, width, height, sort_order | N:1 item; the file lives in Cloud Storage |
| `service_records` | item_id, performed_on, title, performed_by, responsible_person, description | N:1 item; free text for who did it (no link to providers or users); archivable and versioned like the other records, never deleted |
| `service_record_documents` | service_record_id, name, storage_key, content_type, size_bytes | N:1 service record; the file lives in Cloud Storage; `created_by` is the uploader; versioned (rename); deleted for real, with the file, and the audit log keeps the trace |
| `manufacturers` | name (unique), note | M:N service providers |
| `service_providers` | code, name, contact_person, phone, email, web, note | M:N manufacturers |
| `manufacturer_service_providers` | manufacturer_id, service_provider_id, priority | unique pairs (manufacturer, provider) and (manufacturer, priority); the whole order is saved in one transaction |
| `inventories` | location_id, status, ended_at, ended_by, note, committee | one inventory run of a location and its subtree; never archived or deleted (§9.5) |
| `inventory_items` | inventory_id, item_id, kind, location_id, registered_location_id, checked_at, checked_by, method, was_missing, moved_at, moved_by, outcome | N:1 run, N:1 item, unique per run; the snapshot taken at the start plus the items found or added during the run (§9.5) |
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

- One module per domain: `locations`, `items`, `photos`, `service-records`, `manufacturers`, `service-providers`, `users`, `audit`, `inventory` (§9).
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
| `PUT /manufacturers/{id}/service-providers` | send the whole new order at once, after every drop | Write |
| `GET /service-providers`, `GET /service-providers/{id}` | list (search covers name, code, phone and the brands serviced; `archived=true` = the archived providers), detail with brands; list rows carry their brands too | Read |
| `POST /service-providers`, `PATCH /service-providers/{id}` | create, edit; an optional `manufacturerIds` sets the brands in the same transaction (a new brand ranks the provider last, a dropped one closes the gap) and the answer is the provider with its brands | Write |
| `POST /service-providers/{id}/archive`, `/restore` | archive, restore | Write |
| `PUT /service-providers/{id}/manufacturers` | send the whole set of brands the provider services with the provider's `version`; a new brand ranks it last, a change bumps the version | Write |
| `GET /items?missing=true` | only the items marked Nezvěstná; combinable with `q` and `archived`; item responses carry `missingSince` | Read |
| `GET /items/labels?q=&missing=` | `{id, code, name}` of every item matching the search, at most 500, plus the total; for "Vybrat vše (N)" | Read |
| `GET /items/by-code/{code}` | the item with this ID (case ignored, archived too) or 404; for the quick scan | Read |
| `POST /items/{id}/mark-found` | clear Nezvěstná, with `version` | Write |
| `POST /items` with `inventoryId` | also adds the new item to that run as Nové (§9.3 rule 9) | Write |
| `GET /items/{id}/inventories` | the runs the item was in, newest first, with its result in each | Read |
| `GET /locations/{id}/inventories` | the runs of this location and of the locations above it that included it, newest first | Read |
| `GET /inventories?state=open\|closed&q=` | runs in progress / finished and cancelled (newest end first), with counts and participants; `q` over the root location | Read |
| `GET /inventories/preview?locationId=` | item and location counts for the start screen, and the run in progress it would overlap, if any | Write |
| `POST /inventories` | start a run for `locationId`; takes the snapshot; `inventory_overlap` 409 | Write |
| `GET /inventories/{id}` | a run: root and path, state, times, people, counts, every location of the subtree with its counts, note, committee, organization header | Read |
| `GET /inventories/{id}/items?locationId=` | the run's rows (all, not paged), optionally of one location, by item name; only the rows a person sees (items archived since the start, and found or added items that are not checked, are left out) | Read |
| `POST /inventories/{id}/scans` | check by code (`{code, locationId?, method?}`); answers an `outcome` (§9.6) | Write |
| `POST /inventories/{id}/items/{itemId}/check`, `/uncheck` | tick or untick an item by hand; no body (the row already knows its location, so no context is needed); answers the row; an item that is already checked is left as it is (the first check wins) | Write |
| `POST /inventories/{id}/items/{itemId}/move` | move the item to a location of the run (`{locationId, version}`, the item's version) | Write |
| `POST /inventories/{id}/finish` | `{version, missingItemIds, note?, committee?}`: end the run, mark those still unchecked Nezvěstná | Write |
| `POST /inventories/{id}/cancel` | `{version}`: end the run as cancelled | Write |
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

## 9. Inventory (Inventura) and labels

Specified 2026-10-09; the first slice is built, see "Built so far" in §9.8. Sources: the design brief for the canvas (its "decided" section) and the canvas frames 17–27 (rows "Inventura a štítky"). Where the canvas and the brief disagree, this section records the choice; the points the client settled on 2026-10-09 are marked *Decided*. Everything else follows the brief, and the parts added here that neither source has are marked *Proposed*.

### 9.1 Scope

**In:**

- **Inventory runs:** a physical check that items are where the register says, for one location including all its sub-locations. Several people can work on one run at once. Items are checked by scanning their QR label on a phone or by ticking them in a checklist on any device.
- **The Nezvěstná (missing) status** on items: set when a run finishes, cleared when the item turns up.
- **A printable protocol** (inventurní soupis) and **a CSV export** of every finished run.
- **QR labels** for items, printed on A4 label sheets on an office printer.
- **A quick scan** outside a run, which opens the scanned item's detail.

**Not in:** offline scanning (a scan needs a connection), labels for locations, other barcodes (EAN, manufacturers' codes), scanning on a desktop webcam, scheduled or recurring inventories and reminders, and a "decommissioned" status (an item is still retired with Archive).

### 9.2 Terms

| Term (UI) | Meaning |
| --- | --- |
| Run (*Inventura*) | One check of one location (the run's **root**) and its whole subtree. States: *Probíhá* (in progress), then *Dokončená* (finished) or *Zrušená* (cancelled). The last two are final. A run has no name or code; it is shown as the root location and the start date. |
| List (*seznam*) | The items the run expects to find. It is a snapshot taken at the start: every active item whose location is the root or any active location below it. The count it starts with ("128") stays fixed. |
| Check (*kontrola*) | One item marked as seen, with who, when and how ("sken" or "ručně"). |
| Context location | The location whose screen the user is on when checking: a sub-location's checklist, or the root on the run overview. Items found and items created are recorded there, and "Přesunout sem" moves an item there. |
| Results per item | **Nalezeno**: on the list and checked. **Nalezeno jinde**: not on the list, registered somewhere else or nowhere, found during the run. **Nové**: created during the run from the run's screens. **Nezvěstná**: on the list, not checked, marked missing at the finish. **Nezkontrolováno**: on the list, not checked, not marked missing. While a run is in progress, an unchecked item shows as *Zbývá* ("Čeká na kontrolu" in the item's history). |

### 9.3 Rules

1. **Who:** Write and Admin take inventory: start, check, uncheck, move, add a new item, finish, cancel, and mark a missing item found. Read users see the runs, results and histories, print protocols and labels, export CSV and use the quick scan, but get no inventory actions. The API enforces this, as everywhere.
2. **Start:** the root is any active location at any level. Items without a location are never on a list.
3. **No overlap** (*Decided*): a run cannot start while another run is in progress for the same location, one above it or one below it. The start screen names the running run and offers "Otevřít" instead. Two starts at the same moment are serialised in the database, so only one can win.
4. **Shared:** anyone with Write can work on any run in progress. Leaving a screen stops nothing. Run screens refresh on their own every 5 seconds while they are visible.
5. **Checking** an item already checked changes nothing, and the user sees who checked it and when. The first check wins.
6. **Found elsewhere:** checking an item that is not on the list (by scan or typed code) adds it to the run as *Nalezeno jinde*, recorded at the context location, with where it was registered at that moment ("Vedeno v: Centrála Brno › Sklad", or "Bez lokality"). This includes an item moved into the run's locations by an ordinary edit after the start.
7. **Wrong sub-location** (*Proposed*): scanning a listed item from a sub-location's checklist when the item is registered in another location of the same run counts as *Nalezeno*. The result shows where it is registered and offers "Přesunout sem".
8. **Moving:** "Přesunout sem" changes the item's location to the context location. "Změnit" lets the user pick another location of the run instead; the default is the last one chosen in this session. "Ponechat" only records the find. A move is an ordinary item change (audit log, the item's `version`). It is not undone when the check is unticked or the run is cancelled, and it does not change the list of any other run in progress.
9. **New items:** "+ Přidat položku, která není v evidenci" and "Přidat novou položku" (from an unknown code) open the item form with the context location filled in. The scanned code, if any, fills the ID. Saving creates the item and adds it to the run as *Nové*, checked by its creator, provided the run is still in progress and the chosen location is in the run. Otherwise the item is only created, and the toast says it was not added to the inventory.
10. **Unticking** an item on the list returns it to *Zbývá*. Unticking a *Nalezeno jinde* or *Nové* item drops it from the run; the item itself stays in the register. A toast offers "Vrátit" (undo).
11. **Archived items:** a scanned archived item is reported and not counted. An item on the list that is archived during the run leaves the progress count and is set to *Nezkontrolováno* at the finish without being offered as missing.
12. **Nezvěstná** (*Decided*: a status on the item):
    - Finishing a run marks the unchecked items the user confirms as *Nezvěstná*, dated with the finish day.
    - The status clears the moment the item is checked in a later run (the scan says "Byla nezvěstná", and unticking doesn't bring it back), or when a writer clicks "Označit jako nalezenou" on the item detail.
    - The item keeps its location. Archiving it doesn't clear the status.
13. **Finish:** any writer may finish. It ends the run for everyone. Checks, moves and new items are refused after it (`inventory_closed`).
14. **Cancel:** any writer may cancel. Nothing is marked missing, the run stays in the list as *Zrušená* with what was checked, read-only. Moves made during the run stay, and so does a cleared Nezvěstná.
15. **Online only:** a check that doesn't reach the server is not saved and says so ("Sken se neuložil", "Zkusit znovu"). There is no offline queue.
16. **Audit:** start, every check and uncheck, finish and cancel are audit entries of the run (entity type `inventory`). Moves and status changes are audit entries of the item. Each is written in the same transaction as the change.

### 9.4 Screens

Every screen has its own URL. Canvas frame numbers are given in brackets. "Not drawn" means the canvas has no frame yet, so this text is the reference (see §11).

#### 9.4.1 Inventura tab — `/?tab=inventory` [17A mobile, 17 desktop]

- *Decided*: the fifth Home tab. On phones the tab bar scrolls sideways (Lokality · Položky · Údržba · Dodavatelé · Inventura); from 1024 px the side menu gets a fifth link, "Inventura".
- Search "Hledat podle lokality…" over the root's name, code and the names along its path (the location search rules of §3.2).
- **Probíhající (N):** cards with:
  - the root's path
  - "84 / 128 zkontrolováno" with the percentage and a progress bar
  - "Zahájil RS · 3. 10. 2026 v 9:15" and the avatars of the people taking part
  - "Pokračovat" for writers, "Zobrazit" for Read.
- **Dokončené (N):** finished and cancelled runs, newest first, paged by 20, with the date, the root and a result line ("120 nalezeno · 3 jinde · 5 nezvěstných"). A cancelled run shows the *Zrušená* badge and "zahájil JN". On desktop this is a table: Lokalita / Datum / Výsledek / Stav.
- "Zahájit inventuru" for writers: in the bottom bar on phones, next to the heading on desktop.
- Empty state: "Zatím žádná inventura" with "Zahájit inventuru".

#### 9.4.2 Start — `/inventories/new` [18]

- Location picker: the item form's location `SearchPicker`, which searches every level and shows the path as a hint.
- Once a location is picked: "Zkontroluje se 128 položek v 6 lokalitách." (counts of active items and of the locations that hold them).
- If the location overlaps a run in progress (not drawn): the warning "Pro tuto lokalitu už probíhá inventura: Centrála Praha, zahájil RS 3. 10. 2026" with "Otevřít". "Zahájit inventuru" is then disabled.
- A location with no items can still be inventoried (to record new ones). The text then says "V lokalitě nejsou žádné položky."
- Buttons: Zrušit / Zahájit inventuru. Starting opens the run overview.

#### 9.4.3 Run overview — `/inventories/$id` while in progress [24]

- **Top bar:** back, the root's name. Dokončit inventuru / Zrušit inventuru are top-bar buttons at every width (a run in progress shows no "Probíhá" badge); the overflow menu was dropped. Read users get neither.
- **Header:** "Inventura od 3. 10. 2026 · zahájil RS", a *Probíhá* badge, "84 / 128 zkontrolováno · 66 %" with a bar, the participants' avatars, and "RS a JN právě pracují" (anyone who checked something in the last 15 minutes).
- **Locations:** a flat list of every location in the subtree that has items on the list or items found there. A location deeper than one level below the root shows its path under the name, so rooms with the same name on different floors stay apart. Items placed directly in the root appear under the root's own name.
  - Each row: name, "24 / 32 položek", and the avatars of the people who checked items there. The row opens that location's checklist.
  - Rows are grouped as **Probíhající** (some checked), **Nekontrolované** (none checked, "Nikdo nezačal") and **Hotovo** (all checked, *Hotovo* badge). Each group is sorted by path in Czech order.
- "Skenovat" (bottom bar, touch devices only) opens the scanner with the root as context. On desktop the note "Skenovat lze v telefonu." takes its place.

#### 9.4.4 Location checklist — `/inventories/$id/locations/$locationId` [25]

- **Top bar:** back (to the overview), the location's name, and the same run actions as the overview.
- **Header:** the path from the root, "24 / 32 zkontrolováno · 75 %" with a bar, the participants.
- **Search** over name and ID within this location's rows.
- **Nezkontrolované (N):** all of them, by name in Czech order. **Zkontrolované (N):** the five most recent, then "… a dalších 19 zkontrolovaných" to expand (and "Zobrazit méně" to fold again). While a search is active, every match is listed.
- **Rows:**
  - Every row: a large checkbox, the name and the ID. Tapping the row toggles it, and Space toggles it from the keyboard. A chevron opens the item detail.
  - A checked row also shows "RS · 10:42" and a scan icon, or the word "ručně" for a hand tick.
  - A *Nalezeno jinde* row shows "Vedeno v: …" and the *Jinde* badge, plus "přesunuto" once moved. A *Nové* row shows "přidáno při inventuře" and the *Nové* badge. An item archived after the start is left out (*Decided* 2026-10-09; it is not counted either, rule 11).
  - Read users, and everyone on a run that is no longer in progress, see the states without checkboxes.
  - A tick shows at once as pending, but the row moves between the groups only when the server has confirmed it, so the screen never shows a check that was not saved. A failure puts the box back and says so ("Zaškrtnutí se neuložilo", rule 15). Every untick offers "Vrátit" (rule 10).
- "+ Přidat položku, která není v evidenci" for writers (rule 9).
- "Skenovat" (touch devices) opens the scanner with this location as context.
- The checklist loads every row of the location at once, not paged; a location holds at most a few hundred items.

#### 9.4.5 Scanner — `/inventories/$id/scan?locationId=` [20, sheets in 20 "výsledky"]

- **Full screen:** the camera with a viewfinder square, "Namiřte na QR štítek položky", close (×), a torch toggle (only where the phone supports it), the context location's name and the counter "84 / 128". Icon buttons have Czech `aria-label`s.
- "Zadat kód ručně" (*Proposed*, not drawn): a field for typing the ID from a damaged label. It counts as a hand tick.
- **Continuous scanning:** the camera stays on. Each result appears as a bottom sheet over it, with a short vibration where the phone supports it, and is announced to screen readers. The same code read again within 3 seconds is ignored.
- **Result sheets:**

  | Sheet | Shown when | Content and actions |
  | --- | --- | --- |
  | Nalezeno (success) | a listed item is checked | name, ID, location; closes on its own after about 2 s |
  | Nalezeno, wrong place (success) | rule 7 | as above plus "Vedeno v: 0.20 – Sklad" with "Přesunout sem" / "Ponechat"; stays open |
  | Již zkontrolováno (neutral) | already checked | "Zkontroloval RS v 10:42", Zavřít |
  | Nalezeno jinde (warning) | rule 6 | "Vedeno v: Centrála Brno › Sklad", "Přesunout sem" (target shown, "Změnit") / "Ponechat" |
  | Byla nezvěstná (success) | the checked item was Nezvěstná | as Nalezeno, plus "Stav Nezvěstná byl zrušen." |
  | Archivovaná položka (info) | the item is archived | "Položka je archivovaná a nezapočítá se." |
  | Neznámý kód | the text has the form of an ID, but no item has it | "Přidat novou položku" (rule 9) / "Skenovat dál" |
  | Cizí kód | the text is not an ID (any other QR) | "Tento kód nepatří do aplikace." |
  | Bez připojení (danger) | the request failed | "Sken se neuložil", "Zkusit znovu" |

  The canvas draws only Nalezeno, Již zkontrolováno and Nalezeno jinde.
- **Camera states** (not drawn):
  - Permission denied: short steps to allow the camera in the browser, and "Kontrolovat ručně", which returns to the checklist.
  - No camera found: the same "Kontrolovat ručně".
- The camera is stopped when the screen is left or the app goes to the background.

#### 9.4.6 Finish and cancel — `/inventories/$id/finish` (not drawn)

- **Summary:** "Nalezeno 120 · Nalezeno jinde 3 (2 přesunuty) · Nové 1 · Nezkontrolováno 5".
- **"Označit jako nezvěstné":** the unchecked items, each with a checkbox, all ticked. Untick the ones known to be elsewhere for a reason (e.g. at a repair shop); they end as *Nezkontrolováno*.
- **Protocol fields** (*Decided*):
  - "Poznámka" (free text, e.g. "Způsob zjištění: fyzická kontrola")
  - "Inventarizační komise" (names and roles, one per line), used for the signature block.
- The note "Dokončením se inventura ukončí pro všechny."
- Buttons: Zpět / Dokončit inventuru. Then the result screen and the toast "Inventura dokončena".
- If someone checked an item in the meantime, it is no longer marked: the server marks only items still unchecked.
- **"Zrušit inventuru"** opens a confirm dialog: "Nic se neoznačí jako nezvěstné a inventura zůstane v seznamu jako Zrušená." Buttons Zpět / Zrušit inventuru, then the toast "Inventura zrušena".

#### 9.4.7 Result — `/inventories/$id` once finished or cancelled (not drawn)

- Read-only, the same for every role.
- **Header:** the root with its path; start and end date and time with who started and who ended it; the participants; the note and the committee.
- **Summary counts**, then the sections **Nezvěstné (N)**, **Nalezeno jinde (N)** (each marked "přesunuto" or "ponecháno"), **Nové (N)**, **Nezkontrolováno (N)**, and **Nalezeno (N)** (collapsed). Rows link to the item.
- **Actions** (finished runs only): "Tisknout protokol" and "Stáhnout CSV".
- A cancelled run shows the *Zrušená* badge and who cancelled it.

#### 9.4.8 Protocol — `/inventories/$id/protocol` (print view, *Decided*, not drawn)

An A4 portrait page made for the browser's print dialog ("Uložit jako PDF" gives a PDF). Contents:

1. **Header:** company name and IČO from the API config (`ORG_NAME`, `ORG_ID_NUMBER`; until they are set, a placeholder line to fill in by hand), the title "Inventurní soupis", the root with its code and path.
2. **Dates and people:** "Zahájena 3. 10. 2026 9:15 (Roman Siro)", "Ukončena 4. 10. 2026 16:02 (Jan Novák)", the note, and "Kontrolu prováděli:" with the participants.
3. **Summary table:** for *Na seznamu při zahájení*, *Nalezeno*, *Nalezeno jinde* (of which moved), *Nové*, *Nezvěstné* and *Nezkontrolováno*, the count and the sum of purchase prices (`144 902,50 Kč`), plus "z toho bez ceny: N" where some items have no price.
4. **Item table**, sorted by location path then name: Č. / ID / Název / Lokalita / Výsledek / Pořizovací cena. The heading row repeats on every page.
5. **Signature block:** one line per committee member (name and role, signature, date). Without a committee, one line per participant.
6. **Footer:** "Vytištěno 9. 10. 2026 · Správa majetku", and page numbers where the browser supports them.

#### 9.4.9 CSV export (*Decided*)

"Stáhnout CSV" on a finished run builds the file in the browser from the run's rows. No extra endpoint is needed.

- Format: UTF-8 with BOM, `;` separator, CRLF line ends, decimal comma. This opens correctly in Czech Excel.
- Columns: ID; Název; Lokalita; Výsledek; Vedeno v; Přesunuto; Zkontroloval; Čas kontroly; Způsob; Pořizovací cena.
- File name: `inventura-LOC-004-2026-10-04.csv` (the root's code and the end date).

#### 9.4.10 Histories, item and location detail, Items list

- **Item detail [6]:**
  - A new "Inventura" section above Servis, with the row "Historie inventur · Poslední kontrola 28. 9. 2026 · nalezeno".
  - When the item is missing: a *Nezvěstná* badge (danger style with an icon) under the title, the line "Poslední inventura: 3. 10. 2026 – nenalezena" linking to the run, and "Označit jako nalezenou" for writers. The badge and the button are not drawn.
- **Item history** `/items/$id/inventories` [26]:
  - The line "Poslední kontrola: 28. 9. 2026 · RS".
  - Every run the item was in, newest first: date, the run's root path, the result badge (*Čeká na kontrolu* while a run is in progress), and a detail line ("Zkontroloval RS · 10:42 · sken", "Při dokončení nezkontrolováno · dokončil JN", "Vedeno v: …", "Přidáno při inventuře").
- **Location detail [5]:** a new "Inventura" section with the row "Historie inventur · Probíhá inventura · poslední dokončená 28. 9. 2026". There is no start button on the location (the brief's decision).
- **Location history** `/locations/$id/inventories` [27]: the runs of this location and of the locations above it that included it ("Centrála Praha (včetně této lokality)"), newest first, with date, scope, state and the whole run's result line. Below the list: "Zobrazují se i inventury nadřazených lokalit, které tuto lokalitu zahrnují."
- **Items list [3]** (not drawn):
  - A missing item carries the *Nezvěstná* badge (on the card and in the table's name column).
  - A "Jen nezvěstné" checkbox sits next to "Zobrazit archivované" (`?missing=true` in the URL; the two can be combined).

#### 9.4.11 Quick scan — `/scan` (*Decided*, not drawn)

- A scan icon (`aria-label` "Skenovat štítek") in the Home top bar, and a "Skenovat štítek" link in the side menu, shown only on touch devices.
- It opens the same scanner without a run: a scanned ID opens that item's detail, archived items included.
- An unknown ID offers "Přidat novou položku" with the ID filled in (writers). A foreign code says "Tento kód nepatří do aplikace."
- Nothing is recorded.

#### 9.4.12 Labels

**Selection** (Home Items tab) [21; desktop not drawn]:

- "Vybrat" in the toolbar turns the rows into checkboxes; on desktop the table gets a checkbox column. Every role may print labels. The button is hidden in the archived view.
- Search and "Jen nezvěstné" still work. The selection survives a new search and a page reload (kept in `sessionStorage`).
- "Vybrat vše (N)" (*Proposed*) selects every item matching the current search, not only the loaded page, at most 500 at a time ("Vybráno 500 z 640 – upřesněte hledání"). It is the way to label a whole room or floor: search for its name, then select all.
- A sticky bar: "Vybráno 12 · Tisknout štítky" and "Zrušit výběr".

**Print** `/labels` [22, 23]:

- The sheet format is fixed: "A4, 3 × 8 štítků, 70 × 37 mm".
- "Začít od pozice" (*Decided*): a small 3 × 8 grid. The user taps the first free label of a partly used sheet; positions before it are drawn as used. Positions count left to right, top to bottom, and the default is 1. Each item prints once.
- The selected items, each removable (×).
- The summary "12 štítků · 1 list · zbylých 9 míst zůstane prázdných", a preview of the sheet(s), and the tip "Tiskněte v měřítku 100 % a bez okrajů".
- "Tisknout" opens the browser's print dialog, which prints only the sheets.

**Label** (70 × 37 mm, black on white only):

- The QR code on the left, about 28 mm including a quiet zone of at least 4 modules. *Decided*: it holds only the item's ID (`INV-73-2023016`), not a URL, with error correction level Q.
- To the right, the ID in bold on one line, at 11 pt shrinking to 8 pt if needed (`INV-73-2023016` fits at full size). Under it, the item's name in up to 2 lines with an ellipsis. No text below 8 pt.
- A 3 mm safe margin inside every label, and nothing else on the label.
- An office printer usually can't print the outer 4–5 mm of the paper. The first test print on the chosen sheets decides whether the outer columns need a wider margin.

### 9.5 Data model

| Table / column | Key columns | Rules |
| --- | --- | --- |
| `inventories` | location_id (root), status (`in_progress` / `finished` / `cancelled`), ended_at, ended_by, note, committee | Started = `created_at` / `created_by`. `ended_*` are set exactly when the status isn't `in_progress` (CHECK). Versioned (finish and cancel send `version`; checks don't bump it). No `archived_at`: runs are never deleted or archived. Partial index on `location_id` where `in_progress`. |
| `inventory_items` | inventory_id, item_id, kind (`expected` / `elsewhere` / `new`), location_id, registered_location_id, checked_at, checked_by, method (`scan` / `manual`), was_missing, moved_at, moved_by, outcome (`missing` / `skipped`) | One row per item per run, unique (inventory_id, item_id). The `expected` rows are inserted at the start (the snapshot). `location_id` is where the row belongs in the run: the item's location at the start, or the context location for a found or new item; a move changes it. `registered_location_id` is where a found-elsewhere item was registered (null = no location). `checked_*` and `method` are set together or all null. `outcome` is set at the finish for unchecked `expected` rows only. An unticked `elsewhere` or `new` row is kept with `checked_at` null and is hidden, so no DELETE grant is needed. |
| `items.missing_since` | date, null | Null = not missing. Set at the finish, cleared by a check or by "Označit jako nalezenou". Partial index where not null, for the "Jen nezvěstné" filter. |

- Checks don't use `version`. They are conditional updates (`… WHERE checked_at IS NULL`), so two people checking the same item can't overwrite each other.
- Every write that needs the run in progress locks its `inventories` row first (`FOR SHARE`; finish and cancel use `FOR UPDATE`), so nothing is checked after the finish.
- **Overlap guard:** a start takes a transaction-level advisory lock, checks for runs in progress on the root's ancestors, the root and its descendants (`WITH RECURSIVE`), then inserts. A tree overlap can't be a plain constraint, and starts are rare.
- Both tables need grants for `app_runtime` (SELECT, INSERT, UPDATE) and an index on every FK column; the migration tests enforce both.

### 9.6 API

The endpoints are listed in §7. Scan answers (`POST /inventories/{id}/scans` with `{code, locationId?, method?}`) carry an `outcome`:

| outcome | Recorded | Extra fields |
| --- | --- | --- |
| `found` | the row is checked | `item`, `row`; `registeredLocation` when rule 7 applies; `wasMissing` |
| `found_elsewhere` | a new `elsewhere` row, checked | `item` (with `version` for a move), `row`, `registeredLocation` (null = no location), `wasMissing` |
| `already_checked` | nothing | `row` with who and when |
| `archived` | nothing | `item` |
| `unknown_code` | nothing | — |

- The SPA checks the code's form (`humanCode`: A–Z, 0–9, `. _ -`, at most 30 characters, case ignored) before calling. Anything else is a foreign code and never reaches the API.
- New error codes: `inventory_overlap` (409), `inventory_closed` (409: the run is finished or cancelled), `location_outside_inventory` (422: a move or context location not in the run), `item_not_in_inventory` (422: uncheck or move of an item the run doesn't have).

### 9.7 Technical notes

- **Camera:**
  - `getUserMedia` with the rear camera; it works only over HTTPS or on localhost.
  - Decoding: the `BarcodeDetector` API for QR where the browser has it (Chrome on Android), otherwise a small QR-only JavaScript decoder (iOS Safari has no `BarcodeDetector`). The decoder is loaded only by the scanner screen.
  - The decoder must run from a same-origin script: the CSP allows no `blob:` workers.
  - The torch is offered only when the camera track reports it. Vibration where `navigator.vibrate` exists (not on iOS).
  - Verify in the installed PWA on an iPhone as well as in the browser.
- **QR on labels:** generated in the browser as SVG by a small library. This one new dependency serves the labels; the scanner's decoder is the other. Labels are positioned in millimetres with print CSS (`@page { size: A4; margin: 0 }`).
- **Live updates:** TanStack Query polling (`refetchInterval` 5 s on run screens, only while visible; the Inventura tab refreshes on focus). No WebSockets.
- **Config:** optional `ORG_NAME` and `ORG_ID_NUMBER` on the API, returned with a run's detail for the protocol header.
- **Item form:** `/items/new?locationId=&inventoryId=&code=`; `POST /items` takes an optional `inventoryId` (rule 9). After saving, it returns to the screen it was opened from, replacing the form in the history.

### 9.8 Build order

One PR per step, each with its tests (CLAUDE.md, Working agreement):

1. **Schema and repository:** the two tables, `items.missing_since`, grants and indexes.
2. **Service:** start (snapshot, overlap lock), scan, check, uncheck, move, finish, cancel, mark found, histories. Unit tests with fakes, plus DB tests for the overlap lock, the snapshot and concurrent checks.
3. **Routes:** shared Zod schemas and error codes, with route tests for every endpoint including 401/403/409.
4. **SPA, run basics:** the Inventura tab, start, overview and location checklist with hand checks and polling. With this, an inventory can be done on any device.
5. **SPA, finish:** finish, cancel and result; the Nezvěstná badge, filter and "Označit jako nalezenou"; item and location histories.
6. **SPA, scanner:** the scanner with all its sheets and camera states, then the quick scan.
7. **SPA, documents:** the protocol print view and the CSV export.
8. **SPA, labels:** label selection and printing; a test print on real sheets.

**Built so far** (2026-10-09), with what differs from the list above:

- **Steps 1–3 for the run itself:** the tables `inventories` and `inventory_items` (complete, all columns of §9.5), the `inventories` module with list, preview, start, detail and **cancel**, the shared schemas and the error codes `inventory_overlap` and `inventory_closed`. The rows of a run (`GET /inventories/{id}/items`) and the hand **check** and **uncheck** are built, with the error code `item_not_in_inventory`; scans, move, finish, mark found and the histories are not.
- **Step 4, part:** the Inventura tab (§9.4.1), the start screen (§9.4.2), the run overview (§9.4.3) and the location checklist (§9.4.4) with hand checks and polling. "+ Přidat položku, která není v evidenci" (rule 9) is left for its own change: it needs `POST /items` with `inventoryId` and the item form's `inventoryId` / `code` parameters.
- **Cancel came forward** from step 5 (decided with the first slice), so that a started run can always be ended; the overview's button holds only *Zrušit inventuru* until finish exists. A cancelled run opens in the same read-only overview until the result screen (§9.4.7) is built.
- **`items.missing_since`** is not added yet; it gets its own migration with the finish step.
- **The audit action CHECK** now allows `start`, `check`, `uncheck`, `finish` and `cancel` (§9.3 rule 16); `start`, `check`, `uncheck` and `cancel` are written.
- **Left out of the overview and the checklist until their step exists:** "Skenovat" (scanner) and "Dokončit inventuru". The checklist of an ended run (cancelled for now) is read-only.
- **`was_missing`** stays false until `items.missing_since` exists; the finish step must make a check clear that status (rule 12).
- **Progress counts** only `expected` rows whose item is not archived; a location row counts the rows visible there (expected plus checked extras). The overall "84 / 128" therefore never passes 100 %.
- **Colour:** the success green is `#197a37` on `#E6F4EA` (4.77:1); the design's `#1B7F3B` is 4.46:1, under WCAG AA for small text.
- **No E2E tests yet:** the repository has no Playwright setup, so the additions below wait for it.

**E2E additions:** start a run, tick items by hand, finish (an unchecked item becomes Nezvěstná), print a protocol; select items and open the label preview. The scanner's decoder is faked in component tests; the camera isn't available in jsdom.

### 9.9 Later

- **Offline inventory:** scans kept in IndexedDB and sent when back online. Excluded now (rule 15); the snapshot model allows it later.
- **Labels for locations** and a single "Tisknout štítek" on the item detail.
- **Native app:** reuses the same `/api/v1`. A Swift or KMP client is generated from the OpenAPI spec, and sign-in uses a bearer token instead of a cookie.

## 10. Iteration plan

Build the API first, with tests, then the SPA on top of finished modules. The UI design is complete, so the SPA can start as soon as the first API module is ready.

1. **Foundation:** answer the Open Questions, set up the GCP project and billing, monorepo, CI, Dockerfile, local environment.
   - Done when `/api/v1/health` runs on Cloud Run from CI.
2. **API:** schema and migrations, Better Auth and roles, then modules in this order: locations (tree, cycles, counts), items with external IDs and search, manufacturers and providers, photos, users; plus audit, OpenAPI, seed data taken from the UI design.
   - Done when every endpoint has an integration test covering roles and runs in production with backups.
3. **SPA:** scaffold with tokens from the UI design, login, Home, detail screens, forms, Users, screen states, PWA. Starts with locations once that API module is ready.
   - Done when the main-flow E2E tests pass on both mobile and desktop.
4. **Go-live:** import existing inventory data (if any), invite users, test a backup restore.
5. **Inventory and labels:** the steps in §9.8.
6. **Future versions:** service/warranty reminders, offline scanning. (Service history and viewing and restoring archived records are done.)

## 11. UI design summary

The finished design ([Evidence majetku — UI design](https://claude.ai/artifact/348Z5z5RWitYajoUzqSoDP)) is the source of truth for visuals. It has screens 1–9 for mobile and desktop, service-provider detail, service record detail and form (10, 11), users, states, a components/tokens overview for React, Tailwind and shadcn/ui, the app icon (16), and the inventory and label frames 17–27.

| Token | Value |
| --- | --- |
| Accent color | `#2454C7` (adjustable in the design) |
| Neutral scale | gray from 50 `#F7F7F8` to 900 `#141417` |
| Status colors | overdue / expired warranty: `#B3261E` on `#FBEAE9`; due within 30 days: `#9A5B00` on `#FDF0DC`; found / finished (inventory): `#1B7F3B` on `#E6F4EA`; new (inventory): the accent on 14 % accent mixed into white |
| Font | system font stack (-apple-system, Segoe UI, Roboto) |
| Type scale | 20/600 screen title, 17/600 top bar, 15/600 names & buttons, 14/400 body, 13/700 uppercase section heading, 12/400 captions |
| Spacing | 4/8 px grid: 4, 8, 12, 16, 24, 32 |
| Radius | 6, 8, 12 px; badges as pills |
| Touch target | min. 44×44 px; button 44 px, small button 36 px |

**What the design added beyond the original brief:** sub-locations with breadcrumb navigation, external item IDs, the Site and Warehouse location types, a single-line address field, provider reordering (arrows in the design, dragging in the app), photos in the form instead of on the detail screen, and a "Pending" status for invited users.

**Inventory and labels (frames 17–27):** Home with the fifth tab (17A mobile, 17 desktop), start (18), scanner and three result sheets (20), the run overview by location (24), the location checklist (25), the item's and the location's inventory history (26, 27), the "Inventura" sections on the item and location detail, label selection (21), label print preview (22) and the printed A4 sheet (23). The canvas replaced the brief's single grouped checklist with the overview (24) and per-location checklists (25), and dropped the variant with a top-bar icon (17B).

**Still to add to the design:**
- a Documents field (Google Drive link) in the item form
- role change and user deactivation
- creating/editing a manufacturer
- inventory, not drawn yet (§9.4):
  - finish summary and the cancel dialog
  - result of a finished or cancelled run
  - the protocol print layout
  - the overlap warning on the start screen
  - the scanner sheets Byla nezvěstná, Archivovaná položka, Neznámý kód, Cizí kód and Bez připojení, the camera-denied and no-camera states, and "Zadat kód ručně"
  - the Nezvěstná badge and "Označit jako nalezenou" on the item detail; the badge, "Jen nezvěstné" and "Vybrat vše (N)" on the Items tab
  - the quick-scan icon in the Home top bar and side menu
  - "Začít od pozice" on the label print screen
  - desktop frames of label selection and printing
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
13. ~~**Offline:** Will users work without signal (warehouses, basements)?~~ *Decided:* inventory scanning is online only; a scan without a connection fails visibly (§9.3). An offline scanner stays a later option.
14. **Location moves:** Should the item detail show a history of location moves? The audit log will capture it either way.
15. **Budget & SLA:** Is `db-f1-micro` without an SLA enough, or should we go straight to a dedicated vCPU with an SLA?
16. **Operations:** Who will own the GCP project and billing, what domain (e.g. `majetek.firma.cz`), what address will invitations be sent from, and who maintains the app after launch?
17. **Design:** Do you have company colors and a logo, or does the accent stay `#2454C7`? Do you want dark mode?
18. **Inventory protocol:** the company name and IČO for the header (`ORG_NAME`, `ORG_ID_NUMBER`), and does the company's accountant accept the protocol's layout (§9.4.8) as the inventurní soupis?
19. **Label sheets:** which product (70 × 37 mm, 24 per A4 sheet) and which printer? A test print decides the margins at the paper's edge (§9.4.12).

Decided for inventory on 2026-10-09 (§9): Nezvěstná is a status on the item; runs may not overlap; QR labels hold only the item's ID, not a URL, so the app's domain doesn't affect printed labels; a finished run has a printable protocol (with purchase prices and totals, a signature block, the company header and a note) and a CSV export; a quick scan opens an item; labels can start at any position of a partly used sheet, one per item; Inventory is the fifth Home tab.
