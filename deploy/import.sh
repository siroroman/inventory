#!/usr/bin/env bash
# Fills the empty Cloud SQL database with the company's inventory and the users admin@, write@ and
# read@example.test, through the Cloud SQL Auth Proxy. The CSVs hold real data and stay out of git.
# Asks for the users' password (not echoed, not stored). Run it by hand in a terminal.
#   deploy/import.sh <locations.csv> <items.csv>
set -euo pipefail
[[ $# -eq 2 && -f "$1" && -f "$2" ]] || { echo "Usage: $0 <locations.csv> <items.csv>" >&2; exit 2; }
locations_csv=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
items_csv=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
cd "$(dirname "$0")/.."
source deploy/config.sh

read -rsp "Password for the users: " password; echo
read -rsp "Repeat it: " again; echo
[[ "$password" == "$again" ]] || { echo "The passwords differ." >&2; exit 1; }
# The sign-in page is public.
(( ${#password} >= 12 )) || { echo "Use at least 12 characters." >&2; exit 1; }

# The service connects through the /cloudsql socket; here the proxy listens on localhost.
url=$(gcloud secrets versions access latest --secret="$SECRET_DATABASE_URL" --project="$PROJECT_ID" |
  sed -E "s#@/${DB_NAME}\?host=.*#@127.0.0.1:${PROXY_PORT}/${DB_NAME}#")

deploy/db-proxy.sh start
trap 'deploy/db-proxy.sh stop' EXIT
DATABASE_URL="$url" SEED_USER_PASSWORD="$password" pnpm --filter api db:import "$locations_csv" "$items_csv"
