#!/usr/bin/env bash
# Protects what setup.sh made: the database cannot be deleted by mistake and can be restored to any
# minute of the last 7 days, and the account Cloud Build runs as is no longer a project Editor.
# setup.sh calls it; a project set up before it existed needs it run once by hand. Needs only gcloud
# (signed in as an owner). Safe to run again: it changes only what is not set yet.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

step() { printf '\n==> %s\n' "$*"; }

step "Cloud SQL $INSTANCE: deletion protection and point-in-time recovery"
# PITR keeps the write-ahead log for 7 days (the most the Enterprise edition allows) beside the
# nightly backups; a restore makes a new instance. gcloud asks before it patches: turning PITR on
# restarts a running instance once, which takes the app offline for about a minute.
read -r deletion pitr < <(gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" \
  --format='value(settings.deletionProtectionEnabled,settings.backupConfiguration.pointInTimeRecoveryEnabled)')
if [[ "$deletion" == True && "$pitr" == True ]]; then
  echo "Already on"
else
  gcloud sql instances patch "$INSTANCE" --project="$PROJECT_ID" \
    --deletion-protection --enable-point-in-time-recovery --retained-transaction-log-days=7
fi

step "Build identity without the Editor role"
# deploy.sh builds in Cloud Build, which runs as the project's default build account. In newer projects
# that is the Compute Engine default account, which Google makes a project Editor. A build reads the
# uploaded source, writes its log and pushes the image: the builder role (which still reaches every
# bucket of the project). Nothing else runs as the Compute Engine account: the service and the
# migration job have their own, and GitHub Actions builds on its runner.
project_number="${PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')}"
compute_sa="${project_number}-compute@developer.gserviceaccount.com"
build_sa=$(gcloud builds get-default-service-account --project="$PROJECT_ID" --format='value(serviceAccountEmail)')
build_sa=${build_sa##*/}
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$build_sa" \
  --role=roles/cloudbuild.builds.builder --condition=None >/dev/null
editor=$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
  --filter="bindings.role=roles/editor AND bindings.members=\"serviceAccount:${compute_sa}\"" \
  --format='value(bindings.role)')
if [[ -n "$editor" ]]; then
  gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$compute_sa" \
    --role=roles/editor --condition=None >/dev/null
  echo "Removed roles/editor from $compute_sa"
else
  echo "$compute_sa has no Editor role"
fi
