#!/usr/bin/env bash
# One-time setup of the Google Cloud project: APIs, image repository, Cloud SQL, database users,
# secrets and the runtime service account. Safe to run again: it skips what already exists.
# Needs gcloud (signed in), cloud-sql-proxy and Docker (for psql). See deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

step() { printf '\n==> %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }
new_password() { openssl rand -hex 24; }

step "Enabling APIs"
gcloud services enable --project="$PROJECT_ID" \
  run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  iamcredentials.googleapis.com

step "Artifact Registry repository $REPO"
exists gcloud artifacts repositories describe "$REPO" --project="$PROJECT_ID" --location="$REGION" ||
  gcloud artifacts repositories create "$REPO" --project="$PROJECT_ID" --location="$REGION" \
    --repository-format=docker --description="Správa majetku images"

step "Cloud SQL instance $INSTANCE (takes several minutes the first time)"
# Public IP without authorized networks: reachable only through the IAM-checked Cloud SQL
# connector (Cloud Run, cloud-sql-proxy). Private IP + Direct VPC egress comes before real use.
exists gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" ||
  gcloud sql instances create "$INSTANCE" --project="$PROJECT_ID" --region="$REGION" \
    --database-version=POSTGRES_17 --edition=enterprise --tier=db-f1-micro \
    --storage-type=SSD --storage-size=10 --availability-type=zonal \
    --ssl-mode=ENCRYPTED_ONLY --backup-start-time=02:00

step "Database $DB_NAME"
exists gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" --project="$PROJECT_ID" ||
  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" --project="$PROJECT_ID"

secret_exists() { exists gcloud secrets describe "$1" --project="$PROJECT_ID"; }
secret_value() { gcloud secrets versions access latest --secret="$1" --project="$PROJECT_ID"; }
create_secret() {
  printf '%s' "$2" | gcloud secrets create "$1" --project="$PROJECT_ID" --data-file=- \
    --replication-policy=user-managed --locations="$REGION" >/dev/null
  echo "Created secret $1"
}
# Passwords live only in Secret Manager; they are read back from there, never printed.
password_from_url() { sed -E 's#^postgresql://[^:]+:([^@]+)@.*#\1#' <<<"$1"; }
socket_url() { echo "postgresql://$1:$2@/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION}"; }

step "Owner user $DB_OWNER and its secret"
if secret_exists "$SECRET_MIGRATION_URL"; then
  owner_password=$(password_from_url "$(secret_value "$SECRET_MIGRATION_URL")")
else
  owner_password=$(new_password)
  if exists gcloud sql users describe "$DB_OWNER" --instance="$INSTANCE" --project="$PROJECT_ID"; then
    gcloud sql users set-password "$DB_OWNER" --instance="$INSTANCE" --project="$PROJECT_ID" --password="$owner_password"
  else
    gcloud sql users create "$DB_OWNER" --instance="$INSTANCE" --project="$PROJECT_ID" --password="$owner_password"
  fi
  create_secret "$SECRET_MIGRATION_URL" "$(socket_url "$DB_OWNER" "$owner_password")"
fi

step "App user $DB_APP (member of app_runtime only) and its secret"
if secret_exists "$SECRET_DATABASE_URL"; then
  app_password=$(password_from_url "$(secret_value "$SECRET_DATABASE_URL")")
else
  app_password=$(new_password)
fi
# Created in SQL by the owner, not with `gcloud sql users create`, which would make it a
# cloudsqlsuperuser member. app_runtime is created here too (the first migration does the same,
# idempotently) so the API can start right after the first deploy.
./db-proxy.sh start
trap './db-proxy.sh stop' EXIT
docker run --rm -i --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$owner_password" postgres:17 \
  psql -v ON_ERROR_STOP=1 -v app_password="$app_password" \
  -h host.docker.internal -p "$PROXY_PORT" -U "$DB_OWNER" -d "$DB_NAME" <<SQL
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') AS need_runtime \gset
\if :need_runtime
  CREATE ROLE app_runtime NOLOGIN;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_APP}') AS need_app \gset
\if :need_app
  CREATE ROLE ${DB_APP} LOGIN IN ROLE app_runtime;
\endif
ALTER ROLE ${DB_APP} PASSWORD :'app_password';
SQL
secret_exists "$SECRET_DATABASE_URL" ||
  create_secret "$SECRET_DATABASE_URL" "$(socket_url "$DB_APP" "$app_password")"

step "Session secret"
secret_exists "$SECRET_AUTH" || create_secret "$SECRET_AUTH" "$(openssl rand -base64 32)"

step "Service accounts"
service_account() {
  exists gcloud iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" --project="$PROJECT_ID" ||
    gcloud iam service-accounts create "$1" --project="$PROJECT_ID" --display-name="$2"
}
grant_secret() {
  gcloud secrets add-iam-policy-binding "$1" --project="$PROJECT_ID" \
    --member="serviceAccount:$2" --role=roles/secretmanager.secretAccessor >/dev/null
}
service_account "$RUN_SA_NAME" "Správa majetku (Cloud Run service)"
service_account "$MIGRATE_SA_NAME" "Správa majetku (migrations)"
# Least privilege: each connects to Cloud SQL and reads only its own secrets.
for sa in "$RUN_SA" "$MIGRATE_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$sa" \
    --role=roles/cloudsql.client --condition=None >/dev/null
done
grant_secret "$SECRET_DATABASE_URL" "$RUN_SA"
grant_secret "$SECRET_AUTH" "$RUN_SA"
grant_secret "$SECRET_MIGRATION_URL" "$MIGRATE_SA"

step "File bucket $BUCKET"
# Private: no public access, uniform access control, soft delete (default 7 days) so a deleted file
# can be recovered. Browsers PUT and GET through signed URLs, so the app's origin needs CORS.
project_number="${PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')}"
app_url="https://${SERVICE}-${project_number}.${REGION}.run.app"
exists gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT_ID" ||
  gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT_ID" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
cors=$(mktemp)
cat >"$cors" <<JSON
[{"origin": ["${app_url}"], "method": ["GET", "PUT"], "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "gs://$BUCKET" --project="$PROJECT_ID" --cors-file="$cors"
rm -f "$cors"
# The service reads, writes and deletes files in this bucket only, and signs its links through IAM
# (signBlob on itself), so there is no key file.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project="$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA" --role=roles/storage.objectUser >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --project="$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA" --role=roles/iam.serviceAccountTokenCreator >/dev/null

step "Done. Next: deploy/deploy.sh"
