#!/usr/bin/env bash
# Start (or stop) a throwaway Postgres cluster for the server's integration tests.
#
#   eval "$(crates/server/scripts/test-pg.sh start)"   # exports DATABASE_URL
#   crates/server/scripts/test-pg.sh stop
#
# Uses the local postgres binaries (apt `postgresql`). When invoked as root the
# cluster runs as the non-root `postgres` user. Data lives in $SIMPRESS_PG_DIR
# (default /tmp/simpress-pg-test); the port is $SIMPRESS_PG_PORT (default 55432).
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="${SIMPRESS_PG_DIR:-/tmp/simpress-pg-test}"
PORT="${SIMPRESS_PG_PORT:-55432}"

run() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

case "${1:-start}" in
  start)
    mkdir -p "$DIR"
    if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$DIR"; fi
    if [ ! -f "$DIR/data/PG_VERSION" ]; then
      run "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
    fi
    if ! run "$PGBIN/pg_ctl" -D "$DIR/data" status >/dev/null 2>&1; then
      run "$PGBIN/pg_ctl" -D "$DIR/data" -w -l "$DIR/log" \
        -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c max_connections=500 -c fsync=off" \
        start >/dev/null
    fi
    echo "export DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    run "$PGBIN/pg_ctl" -D "$DIR/data" -m fast stop
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 2
    ;;
esac
