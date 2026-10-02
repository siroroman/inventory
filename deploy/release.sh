#!/usr/bin/env bash
# Runs the migrations of an already pushed image as a Cloud Run job, then deploys it as the service.
# If the migrations fail, it stops there and the running revision stays as it is.
# Used by deploy.sh (by hand) and by .github/workflows/deploy.yml.
#   deploy/release.sh <image> [extra `gcloud run deploy` flags]
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

image="${1:?Usage: $0 <image> [gcloud run deploy flags]}"
shift
# The service's URL is fixed by the project number, so it is known before the first deploy.
# CI passes PROJECT_NUMBER: its deployer may not read the project.
project_number="${PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')}"
app_url="https://${SERVICE}-${project_number}.${REGION}.run.app"

printf '\n==> Migrating\n'
gcloud run jobs deploy "$MIGRATE_JOB" --project="$PROJECT_ID" --region="$REGION" \
  --image="$image" --service-account="$MIGRATE_SA" \
  --set-cloudsql-instances="$SQL_CONNECTION" \
  --set-secrets="MIGRATION_DATABASE_URL=${SECRET_MIGRATION_URL}:latest" \
  --command=node --args=apps/api/src/db/migrate.cli.ts \
  --max-retries=0 --task-timeout=10m \
  --execute-now --wait

printf '\n==> Deploying %s\n' "$app_url"
gcloud run deploy "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --image="$image" --service-account="$RUN_SA" \
  --add-cloudsql-instances="$SQL_CONNECTION" \
  --set-secrets="DATABASE_URL=${SECRET_DATABASE_URL}:latest,BETTER_AUTH_SECRET=${SECRET_AUTH}:latest" \
  --set-env-vars="BETTER_AUTH_URL=${app_url},STORAGE_BUCKET=${BUCKET}" \
  --min-instances=0 --max-instances=2 --memory=512Mi --cpu=1 \
  "$@"

printf '\n==> Live at %s\n' "$app_url"
