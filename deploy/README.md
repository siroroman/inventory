# Deploying to Google Cloud

A test deployment: one Cloud Run service (API + SPA from the `Dockerfile`), a Cloud Run job for the
migrations, Cloud SQL for PostgreSQL 17 (smallest tier), Secret Manager, region `europe-west3`.
Settings are in `config.sh`; the project is the one from `gcloud config`.

Invitations and password reset do not work yet (their adapters are not written). Cloud SQL keeps a
public IP without authorized networks: it is reachable only through the IAM-checked, encrypted Cloud
SQL connector. That was chosen over a private IP only, which would need a bastion VM for the scripts
run from a laptop (import, update, seed).

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

`deploy/setup-protection.sh` (only `gcloud`; `setup.sh` calls it, a project set up before it existed
needs it run once) turns on deletion protection and point-in-time recovery for Cloud SQL: 7 days of
write-ahead log beside the nightly backups, so a mistake can be undone to the minute (a restore makes
a new instance). Turning PITR on restarts a running instance once, about a minute offline; gcloud
asks first. It also takes the Editor role from the Compute Engine default account, which Cloud Build
runs the builds of `deploy.sh` as, and leaves it the builder role. If `deploy.sh` then fails to
build, the build account is missing a permission: give it back with
`gcloud projects add-iam-policy-binding <project> --member=serviceAccount:<number>-compute@developer.gserviceaccount.com --role=roles/editor`.

## Accounts that control production

The Google account that owns the project and every GitHub account that can push to `main` control
production: the database, its backups and the secrets, and a push to `main` deploys once CI is green.
Turn on 2-Step Verification on both, with a passkey or a security key rather than SMS.

`main` is not protected: GitHub offers branch protection for private repositories on a paid plan
only. With one, require a pull request and the four CI checks, for admins too:

```
gh api -X PUT repos/siroroman/inventory/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [{ "context": "Lint, typecheck, test" }, { "context": "Dependency audit" },
               { "context": "Secret scan" }, { "context": "Semgrep" }]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

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

Cloud SQL `db-f1-micro` is about $10/month. The service keeps one instance warm (`--min-instances=1` in
`deploy/release.sh`), so nobody waits 5-8 s for a cold start; an idle instance of 1 vCPU / 512 MiB is
billed at the lower idle rate, a few dollars a month (check the current Cloud Run price list). To go back to
scale-to-zero, set `--min-instances=0` there or run
`gcloud run services update inventory --region=europe-west3 --min-instances=0`.
To stop paying for the database: `gcloud sql instances patch inventory-db --activation-policy=NEVER`
(and `ALWAYS` to start it again). Point-in-time recovery adds a little backup storage for the
write-ahead log. Deletion protection must be turned off first
(`gcloud sql instances patch inventory-db --no-deletion-protection`) before the instance or the
project can be deleted; deleting the project removes everything.
