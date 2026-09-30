#!/usr/bin/env bash
# Opens the Cloud SQL database on localhost:$PROXY_PORT through the Cloud SQL Auth Proxy, with your
# gcloud sign-in. Used by setup.sh, and by hand for the seed or a psql session.
#   deploy/db-proxy.sh start | stop
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

pid_file="${TMPDIR:-/tmp}/inventory-cloud-sql-proxy.pid"
log_file="${TMPDIR:-/tmp}/inventory-cloud-sql-proxy.log"

case "${1:-}" in
  start)
    command -v cloud-sql-proxy >/dev/null || { echo "Install it: brew install cloud-sql-proxy" >&2; exit 1; }
    if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "Proxy already running on 127.0.0.1:$PROXY_PORT"
      exit 0
    fi
    cloud-sql-proxy --gcloud-auth --port "$PROXY_PORT" "$SQL_CONNECTION" >"$log_file" 2>&1 &
    echo $! >"$pid_file"
    for _ in $(seq 1 30); do
      grep -q 'ready for new connections' "$log_file" && { echo "Proxy on 127.0.0.1:$PROXY_PORT"; exit 0; }
      kill -0 "$(cat "$pid_file")" 2>/dev/null || break
      sleep 1
    done
    echo "Proxy did not start, see $log_file" >&2
    exit 1
    ;;
  stop)
    [[ -f "$pid_file" ]] && kill "$(cat "$pid_file")" 2>/dev/null || true
    rm -f "$pid_file"
    ;;
  *)
    echo "Usage: $0 start|stop" >&2
    exit 2
    ;;
esac
