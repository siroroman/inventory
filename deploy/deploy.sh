#!/usr/bin/env bash
# Builds the image in Cloud Build, then migrates and deploys it with release.sh.
# Deploys the committed HEAD: uncommitted changes are refused, so what runs is always in git.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes; commit or stash them first." >&2
  exit 1
fi
image="${IMAGE_BASE}:$(git rev-parse --short=12 HEAD)"

printf '\n==> Building %s\n' "$image"
# `git archive` uploads exactly the committed tree (no node_modules, .env files or build output).
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git archive HEAD | tar -x -C "$src"
gcloud builds submit "$src" --project="$PROJECT_ID" --region="$REGION" --tag="$image"

# Making the service public needs run.admin, which only the person running this has; CI leaves
# the existing IAM policy alone.
deploy/release.sh "$image" --allow-unauthenticated
