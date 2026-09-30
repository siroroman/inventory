#!/usr/bin/env bash
# Builds the image in Cloud Build, runs the migrations as a Cloud Run job and deploys the service.
# If the migrations fail, it stops there and the running revision stays as it is.
# Deploys the committed HEAD: uncommitted changes are refused, so what runs is always in git.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes; commit or stash them first." >&2
  exit 1
fi
image="${IMAGE_BASE}:$(git rev-parse --short=12 HEAD)"
# The service's URL is fixed by the project number, so it is known before the first deploy.
project_number=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
app_url="https://${SERVICE}-${project_number}.${REGION}.run.app"

printf '\n==> Building %s\n' "$image"
# `git archive` uploads exactly the committed tree (no node_modules, .env files or build output).
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git archive HEAD | tar -x -C "$src"
gcloud builds submit "$src" --project="$PROJECT_ID" --region="$REGION" --tag="$image"

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
  --set-env-vars="BETTER_AUTH_URL=${app_url}" \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=2 --memory=512Mi --cpu=1

printf '\n==> Live at %s\n' "$app_url"
