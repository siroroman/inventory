# Deploying to Google Cloud

A test deployment: one Cloud Run service (API + SPA from the `Dockerfile`), a Cloud Run job for the
migrations, Cloud SQL for PostgreSQL 17 (smallest tier), Secret Manager, region `europe-west3`.
Settings are in `config.sh`; the project is the one from `gcloud config`.

Not production-ready yet: Cloud SQL uses a public IP without authorized networks (reachable only
through the IAM-checked connector) instead of private IP + Direct VPC egress, deploys are run by
hand, and photos, invitations and password reset do not work (their adapters are not written).

## Prerequisites

- `gcloud` signed in (`gcloud auth login`), project set, billing linked
- `brew install cloud-sql-proxy`, Docker running

## Once

```
deploy/setup.sh      # APIs, Artifact Registry, Cloud SQL, DB users, secrets, service accounts
```

Passwords are generated into Secret Manager and never printed. The API's database user
`inventory_app` is created in SQL as a member of `app_runtime` only.

## Every deploy

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
