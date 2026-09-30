# Shared settings for setup.sh, deploy.sh and db-proxy.sh. Sourced, not run.
# The project comes from `gcloud config set project <id>` unless PROJECT_ID is set.

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "No project: run 'gcloud config set project <id>' or set PROJECT_ID" >&2
  exit 1
fi

REGION=europe-west3
SERVICE=inventory                 # Cloud Run service
MIGRATE_JOB=inventory-migrate     # Cloud Run job running the migrations
REPO=inventory                    # Artifact Registry repository
INSTANCE=inventory-db             # Cloud SQL instance
DB_NAME=inventory
DB_OWNER=inventory                # runs migrations (DDL); Cloud SQL makes it a cloudsqlsuperuser member
DB_APP=inventory_app              # the API's login, member of app_runtime only
# Two identities, so the service never holds the owner's credentials.
RUN_SA_NAME=inventory-run         # the service: app user's secret + session secret
RUN_SA="${RUN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
MIGRATE_SA_NAME=inventory-migrate # the migration job: owner's secret
MIGRATE_SA="${MIGRATE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${INSTANCE}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/app"

# Secret Manager names.
SECRET_DATABASE_URL=database-url
SECRET_MIGRATION_URL=migration-database-url
SECRET_AUTH=better-auth-secret

# Local port of the Cloud SQL Auth Proxy (5432 is the local dev database).
PROXY_PORT=5433

# GitHub Actions deploys (setup-github.sh, .github/workflows/deploy.yml).
GITHUB_REPO=siroroman/inventory
DEPLOY_SA_NAME=inventory-deploy   # the workflow's identity: push images, run the job, deploy
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_POOL=github                   # Workload Identity pool and provider trusting GitHub's OIDC tokens
WIF_PROVIDER=github
