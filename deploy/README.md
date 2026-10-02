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
project set up before the bucket existed needs `deploy/setup.sh` run again (it skips what exists)
before the first deploy that sets `STORAGE_BUCKET`; until then uploads fail.

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

## Cost

Cloud SQL `db-f1-micro` is about $10/month; the rest stays within the free tiers at test traffic.
To stop paying for the database: `gcloud sql instances patch inventory-db --activation-policy=NEVER`
(and `ALWAYS` to start it again). Deleting the project removes everything.
