#!/usr/bin/env bash
# Creates the private file bucket (photos, service record documents) and lets the Cloud Run service
# use it. Needs only gcloud (signed in) and the runtime service account, which setup.sh creates;
# setup.sh calls this script. Safe to run again: it skips what exists and re-applies CORS and IAM.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

step() { printf '\n==> %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

step "Enabling APIs"
gcloud services enable --project="$PROJECT_ID" storage.googleapis.com iamcredentials.googleapis.com

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
