#!/usr/bin/env bash
# Brings the Cloud SQL database in line with the accounting workbook (exported as CSV, see
# apps/api/src/db/update/): a dry run by default, which writes the review files into <out-dir>; with
# --apply <fingerprint> (printed by the dry run) it writes, as the database owner, in one transaction.
# Take a backup first: gcloud sql backups create --instance=inventory-db
# The CSV and the decisions file hold company data and stay out of git. Run it by hand in a terminal.
#   deploy/update.sh <accounting.csv> <decisions.json> <out-dir>
#   deploy/update.sh <accounting.csv> <decisions.json> <out-dir> --apply <fingerprint>
set -euo pipefail
[[ $# -eq 3 || ( $# -eq 5 && "$4" == "--apply" ) ]] || { sed -n 2,9p "$0" >&2; exit 2; }
[[ -f "$1" && -f "$2" ]] || { echo "Missing $1 or $2" >&2; exit 2; }
csv=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
decisions=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
mkdir -p "$3"
out=$(cd "$3" && pwd)
apply=()
cd "$(dirname "$0")/.."
source deploy/config.sh
# The dry run reads as the API's own user; only the apply needs the owner (it sets the code sequence).
secret=$SECRET_DATABASE_URL
if [[ $# -eq 5 ]]; then
  apply=(--apply --expect "$5")
  secret=$SECRET_MIGRATION_URL
fi

# The service connects through the /cloudsql socket; here the proxy listens on localhost.
url=$(gcloud secrets versions access latest --secret="$secret" --project="$PROJECT_ID" |
  sed -E "s#@/${DB_NAME}\?host=.*#@127.0.0.1:${PROXY_PORT}/${DB_NAME}#")
[[ "$url" == *"@127.0.0.1:${PROXY_PORT}/"* ]] || { echo "Unexpected form of the $secret secret" >&2; exit 1; }

deploy/db-proxy.sh start
trap 'deploy/db-proxy.sh stop' EXIT
DATABASE_URL="$url" pnpm --filter api db:update-inventory "$csv" "$decisions" --out "$out" ${apply[@]+"${apply[@]}"}
