#!/usr/bin/env bash
# One-time setup for deploys from GitHub Actions (.github/workflows/deploy.yml), after setup.sh.
# GitHub signs in through Workload Identity Federation: no service account key exists anywhere.
# Only workflows of $GITHUB_REPO running on main may act as the deployer. Safe to run again.
# Needs gcloud (signed in) and gh (signed in, admin on the repository).
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

step() { printf '\n==> %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

project_number=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
# The numeric id, not the name: a deleted and re-created repository with the same name is not trusted.
repo_id=$(gh api "repos/${GITHUB_REPO}" --jq .id)

step "Enabling APIs"
gcloud services enable --project="$PROJECT_ID" iamcredentials.googleapis.com sts.googleapis.com

step "Workload Identity pool $WIF_POOL and provider $WIF_PROVIDER"
exists gcloud iam workload-identity-pools describe "$WIF_POOL" --project="$PROJECT_ID" --location=global ||
  gcloud iam workload-identity-pools create "$WIF_POOL" --project="$PROJECT_ID" --location=global \
    --display-name="GitHub Actions"
exists gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" --project="$PROJECT_ID" \
    --location=global --workload-identity-pool="$WIF_POOL" ||
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" --project="$PROJECT_ID" \
    --location=global --workload-identity-pool="$WIF_POOL" \
    --display-name="GitHub ${GITHUB_REPO}" \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository_id == '${repo_id}' && assertion.ref == 'refs/heads/main'"

step "Deployer service account $DEPLOY_SA_NAME"
exists gcloud iam service-accounts describe "$DEPLOY_SA" --project="$PROJECT_ID" ||
  gcloud iam service-accounts create "$DEPLOY_SA_NAME" --project="$PROJECT_ID" \
    --display-name="Správa majetku (GitHub deploy)"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository_id/${repo_id}" \
  >/dev/null

step "Deployer permissions"
# Least privilege: push to one repository, manage Cloud Run (not its IAM policy, so it cannot make
# anything public or private), and run as the two runtime identities. No secret access: the job and
# the service read their secrets as their own service accounts.
gcloud artifacts repositories add-iam-policy-binding "$REPO" --project="$PROJECT_ID" --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" \
  --role=roles/run.developer --condition=None >/dev/null
for sa in "$RUN_SA" "$MIGRATE_SA"; do
  gcloud iam service-accounts add-iam-policy-binding "$sa" --project="$PROJECT_ID" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser >/dev/null
done

step "GitHub repository variables (not secrets: none of these grants anything on its own)"
gh variable set GCP_PROJECT_ID --repo="$GITHUB_REPO" --body="$PROJECT_ID"
gh variable set GCP_PROJECT_NUMBER --repo="$GITHUB_REPO" --body="$project_number"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo="$GITHUB_REPO" \
  --body="projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo="$GITHUB_REPO" --body="$DEPLOY_SA"

step "Done. Pushes to main now deploy once CI is green."
