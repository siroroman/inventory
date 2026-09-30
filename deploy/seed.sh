#!/usr/bin/env bash
# Fills the empty Cloud SQL database with the sample data and the users admin@, write@ and
# read@example.test, through the Cloud SQL Auth Proxy. Asks for their password (not echoed,
# not stored). Run it by hand in a terminal: it needs the keyboard.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

read -rsp "Password for the test users: " password; echo
read -rsp "Repeat it: " again; echo
[[ "$password" == "$again" ]] || { echo "The passwords differ." >&2; exit 1; }
# The sign-in page is public.
(( ${#password} >= 12 )) || { echo "Use at least 12 characters." >&2; exit 1; }

# The service connects through the /cloudsql socket; here the proxy listens on localhost.
url=$(gcloud secrets versions access latest --secret="$SECRET_DATABASE_URL" --project="$PROJECT_ID" |
  sed -E "s#@/${DB_NAME}\?host=.*#@127.0.0.1:${PROXY_PORT}/${DB_NAME}#")

deploy/db-proxy.sh start
trap 'deploy/db-proxy.sh stop' EXIT
DATABASE_URL="$url" SEED_USER_PASSWORD="$password" pnpm --filter api db:seed
