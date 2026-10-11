# Deploying to Google Cloud

A test deployment: one Cloud Run service (API + SPA from the `Dockerfile`), a Cloud Run job for the
migrations, Cloud SQL for PostgreSQL 17 (smallest tier), Secret Manager, region `europe-west3`.
Settings are in `config.sh`; the project is the one from `gcloud config`.

Not production-ready yet: Cloud SQL uses a public IP without authorized networks (reachable only
through the IAM-checked connector) instead of private IP + Direct VPC egress, and invitations and password reset do not work (their adapters are not written).

## Prerequisites

- `gcloud` signed in (`gcloud auth login`), project set, billing linked
- `brew install cloud-sql-proxy`, Docker running

## Once

```
deploy/setup.sh      # APIs, Artifact Registry, Cloud SQL, DB users, secrets, service accounts, file bucket
```

Passwords are generated into Secret Manager and never printed. The API's database user
`inventory_app` is created in SQL as a member of `app_runtime` only.

Photos and service record documents live in a private bucket, `<project>-inventory-files`
(`BUCKET` in `config.sh`): uniform access, public access prevention, soft delete, CORS for the
app's URL. The service account may manage objects in that bucket only, and sign download and upload
links through IAM (`roles/iam.serviceAccountTokenCreator` on itself), so there is no key file. A
project set up before the bucket existed needs `deploy/setup-storage.sh` (only `gcloud`; `setup.sh`
calls it too, and both skip what exists) run before the first deploy that sets `STORAGE_BUCKET`;
until then uploads fail with a 500 (`signBlob` denied).

Then let GitHub Actions deploy (needs `gh` signed in as a repository admin):

```
deploy/setup-github.sh   # Workload Identity Federation, deployer service account, repo variables
deploy/deploy.sh         # the first deploy by hand: it also makes the service public
```

## Every deploy

A push to `main` deploys by itself once CI is green on it (`.github/workflows/deploy.yml`): the
runner builds the image, pushes it to Artifact Registry, and `release.sh` runs the migrations job
and then deploys the service. If the migrations fail the workflow stops and the old revision keeps
running. Actions → Deploy → Run workflow redeploys the current `main`.

GitHub holds no key: the workflow gets short-lived Google credentials through Workload Identity
Federation, and Google accepts them only from this repository's `main`. The deployer
`inventory-deploy` may push images, deploy Cloud Run and act as the two runtime service accounts;
it cannot read secrets or change who may call the service. Deploys show under the GitHub
environment `test`, where required reviewers can be added (repository settings) to approve each one.

By hand, from any clean checkout:

```
deploy/deploy.sh     # build (Cloud Build) -> migrate (job) -> deploy (service); commits only
```

The URL is `https://inventory-<project number>.europe-west3.run.app`; `BETTER_AUTH_URL` is set
to it automatically.

## Test users and sample data

`db:seed` fills an empty database with sample data and `admin@`, `write@` and `read@example.test`.
Choose a strong password: the sign-in page is public.

```
deploy/seed.sh      # asks for the password; type it in a terminal
```

## Real inventory

`db:import` fills an empty database with the company's inventory from two CSV files (centres and
items, prepared from the accounting and electrician spreadsheets) and the same three users as the
seed. The files hold real company data: keep them out of the repository.

```
deploy/import.sh <locations.csv> <items.csv>   # asks for the users' password
```

Each centre becomes a top-level location whose ID is its centre number behind a prefix (`LOC-50`,
`LOC-620`). Items are numbered by the database, `INV-0001`, `INV-0002`...; the accounting inventory
number becomes the external ID `Účetnictví` (`<centre>-<number>`, e.g. `73-2023016`, the numbers
repeat across centres) and the electrician's IDs the external ID `Revize ILKO`; the other columns of
the files go into the item's note. Any bad row stops the import and nothing is written.

## Updating from the accounting workbook

The accounting workbook (DLHM and small assets, one sheet per cost centre) is exported to a CSV
(`sheet,table,centre,inv_number,registered_on,name,price,price_increased`) and read together with a
decisions file (`asOf`, `newLocations`, `merge`, `skip`; see `apps/api/src/db/update/plan.ts`).
Both hold company data and stay out of git. The first run also renumbered every item, which is why
it refuses a database where an item already has the external ID `Původní kód`.

```
gcloud sql backups create --instance=inventory-db        # the safety net
deploy/update.sh <accounting.csv> <decisions.json> <out-dir>                     # dry run
deploy/update.sh <accounting.csv> <decisions.json> <out-dir> --apply <fingerprint>
```

The dry run writes nothing (read-only transaction) and puts `mapping.csv` (old → new code),
`changes.csv`, `new-items.csv`, `review.csv` (new rows that look like an existing item) and
`left-alone.csv` into the directory, and prints the fingerprint of the plan. `--apply` needs that
fingerprint, so only the reviewed plan is written; it takes the migration owner's connection (it sets
the code sequence), locks the items table and runs in one transaction with audit entries.

### Starting over

Only while the database holds nothing worth keeping. The roles (`app_runtime`, `inventory_app`) are
cluster-wide and survive.

```
gcloud sql backups create --instance=inventory-db          # optional safety net
gcloud sql databases delete inventory --instance=inventory-db
gcloud sql databases create inventory --instance=inventory-db
```

Then run the Deploy workflow (Actions → Deploy → Run workflow) to apply the migrations, empty the
file bucket (`gcloud storage rm "gs://<project>-inventory-files/**"`) and run `deploy/import.sh`.
If the delete fails on open connections, run `DROP DATABASE inventory WITH (FORCE);` as the owner
through `deploy/db-proxy.sh` (connected to the `postgres` database), then create it again.

## Cost

Cloud SQL `db-f1-micro` is about $10/month; the rest stays within the free tiers at test traffic.
To stop paying for the database: `gcloud sql instances patch inventory-db --activation-policy=NEVER`
(and `ALWAYS` to start it again). Deleting the project removes everything.
