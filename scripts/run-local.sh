#!/usr/bin/env bash
# Run swarm.press on one origin from the owner's machine (increment G2): the
# built game served by swarmpress-server, the API on the same origin
# (SWARMPRESS_STATIC_DIR, SWARMPRESS_PUBLIC_URL = the server's own origin).
#
#   scripts/run-local.sh [--env FILE] [--build] [--release] [--yes] [--check] [--live-site]
#
#   --env FILE    the environment file to load (default .env; start from .env.example)
#   --build       build first: `pnpm build` (release wasm, typecheck, Vite) and the server
#   --release     run the server's release build
#   --yes         do not ask before starting against a real GitHub
#   --check       start the server, check the single-origin page (COOP/COEP, the SPA
#                 fallback, the API), stop it again and exit
#   --live-site   allow a binding to swarmpress/cinqueterre.travel, the live site (Milestone C,
#                 after cutover step 0; docs/runbooks/fork-rehearsal.md)
#
# Before anything starts it checks the prerequisites and the configuration the
# server would refuse anyway, and prints which repository the company writes
# to: the server's default for new companies and the binding of every company
# already in the database. See docs/guides/getting-started.md.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

LIVE_SITE=swarmpress/cinqueterre.travel
ENV_FILE=.env
BUILD=0 RELEASE=0 YES=0 CHECK=0 LIVE_OK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE=${2:?--env needs a file}; shift 2 ;;
    --build) BUILD=1; shift ;;
    --release) RELEASE=1; shift ;;
    --yes) YES=1; shift ;;
    --check) CHECK=1; shift ;;
    --live-site) LIVE_OK=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "run-local: unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done

die() { echo "run-local: $*" >&2; exit 1; }
truthy() { case "${1:-}" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# Whether `owner/name` is on the comma-separated allow-list (without case).
allowed() {
  local repo item
  repo=$(lower "$1")
  [ -z "${SWARMPRESS_ALLOWED_SITE_REPOS// /}" ] && return 0
  IFS=',' read -ra items <<< "$SWARMPRESS_ALLOWED_SITE_REPOS"
  for item in "${items[@]}"; do
    item=$(lower "$(printf '%s' "$item" | tr -d '[:space:]')")
    [ -n "$item" ] && [ "$item" = "$repo" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------- environment
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found: cp .env.example .env and edit it (docs/guides/getting-started.md)"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

BIND=${SWARMPRESS_BIND:-127.0.0.1:8080}
PORT=${BIND##*:}
HOST=${BIND%:*}
HOST=${HOST#[}
HOST=${HOST%]}
case "$PORT" in ''|*[!0-9]*) die "SWARMPRESS_BIND=$BIND must be host:port" ;; esac

export SWARMPRESS_STATIC_DIR=${SWARMPRESS_STATIC_DIR-apps/game/dist}
[ -n "$SWARMPRESS_STATIC_DIR" ] || die "SWARMPRESS_STATIC_DIR is empty: the single-origin run serves the built client (apps/game/dist)"
export SWARMPRESS_PUBLIC_URL=${SWARMPRESS_PUBLIC_URL:-http://localhost:$PORT}
public_port=$(printf '%s' "$SWARMPRESS_PUBLIC_URL" | sed -E 's#^[a-z]+://(\[[^]]*\]|[^/:]*)(:([0-9]+))?.*$#\3#')
if [ -z "$public_port" ]; then
  case "$SWARMPRESS_PUBLIC_URL" in https://*) public_port=443 ;; *) public_port=80 ;; esac
fi
[ "$public_port" = "$PORT" ] || die "SWARMPRESS_PUBLIC_URL=$SWARMPRESS_PUBLIC_URL is not this server's origin (it listens on port $PORT). The single-origin run serves the page and the API together: set SWARMPRESS_PUBLIC_URL=http://localhost:$PORT (Vite's :5173 is for 'pnpm dev')"

MODE=${SWARMPRESS_GITHUB:-real}
case "$MODE" in fake|real) ;; *) die "SWARMPRESS_GITHUB=$MODE must be fake or real" ;; esac
export SWARMPRESS_ALLOWED_SITE_REPOS=${SWARMPRESS_ALLOWED_SITE_REPOS:-}
case "${SWARMPRESS_DEFAULT_SITE_REPO:-}${SWARMPRESS_ALLOWED_SITE_REPOS}${GITHUB_TOKEN:-}" in
  *YOUR_GITHUB_LOGIN*|*PASTE*) die "$ENV_FILE still has a placeholder: fill in your repository and token" ;;
esac
BASE=${SWARMPRESS_DEFAULT_BASE_BRANCH:-main}
ORG=${GITHUB_SITES_ORG:-swarmpress-sites}

# ---------------------------------------------------------------- prerequisites
command -v cargo >/dev/null || die "cargo not found (rustup: see docs/guides/getting-started.md)"
command -v curl >/dev/null || die "curl not found"
if [ "$BUILD" = 1 ]; then
  command -v pnpm >/dev/null || die "pnpm not found"
  command -v node >/dev/null || die "node not found"
  [ -d node_modules ] || die "node_modules missing: run pnpm install first"
  wb=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}') || true
  [ "$wb" = "0.2.100" ] || die "wasm-bindgen CLI 0.2.100 required (found '${wb:-none}'): cargo install wasm-bindgen-cli --version 0.2.100"
elif [ ! -f "$SWARMPRESS_STATIC_DIR/index.html" ]; then
  die "$SWARMPRESS_STATIC_DIR/index.html not found: build the client with --build (or pnpm build)"
fi

# ---------------------------------------------------------------- what the server would refuse
if [ "$MODE" = real ]; then
  if [ -z "${GITHUB_TOKEN:-}" ] && { [ -z "${GITHUB_APP_ID:-}" ] || [ -z "${GITHUB_APP_PRIVATE_KEY_PATH:-}" ]; }; then
    die "SWARMPRESS_GITHUB=real needs GITHUB_TOKEN (a fine-grained token on the site repository) or the GitHub App"
  fi
  [ -n "${SWARMPRESS_ALLOWED_SITE_REPOS// /}" ] || die "SWARMPRESS_ALLOWED_SITE_REPOS is required with a real GitHub: the repositories a company may write to, comma-separated owner/name"
  [ -n "${SWARMPRESS_DEFAULT_SITE_REPO:-}" ] || die "set SWARMPRESS_DEFAULT_SITE_REPO=owner/name: with a real GitHub this script wants the repository new companies write to named explicitly"
  ! truthy "${SWARMPRESS_SIMULATE_DEPLOY:-}" || die "SWARMPRESS_SIMULATE_DEPLOY with a real GitHub would report every merge as live: remove it"
  [ -z "${SWARMPRESS_FAKE_SITE:-}" ] || die "SWARMPRESS_FAKE_SITE seeds the fake GitHub only: remove it"
  [ "${SWARMPRESS_ARTICLE_PROFILE:-enforce}" != off ] || die "SWARMPRESS_ARTICLE_PROFILE=off is for the fake GitHub only: remove it"
  if truthy "${SWARMPRESS_DEV_AUTH:-}"; then
    case "$HOST" in 127.*|localhost|::1) ;; *) die "SWARMPRESS_DEV_AUTH=1 with a real GitHub only on a loopback address (SWARMPRESS_BIND=$BIND)" ;; esac
  fi
fi
if [ -n "${SWARMPRESS_DEFAULT_SITE_REPO:-}" ]; then
  allowed "$SWARMPRESS_DEFAULT_SITE_REPO" || die "SWARMPRESS_DEFAULT_SITE_REPO=$SWARMPRESS_DEFAULT_SITE_REPO is not in SWARMPRESS_ALLOWED_SITE_REPOS"
fi
if [ "$LIVE_OK" != 1 ]; then
  live=$(lower "$LIVE_SITE")
  for v in "${SWARMPRESS_DEFAULT_SITE_REPO:-}" ${SWARMPRESS_ALLOWED_SITE_REPOS//,/ }; do
    [ "$(lower "$v")" != "$live" ] || die "$LIVE_SITE is the live site. It is allowed only for the first live article (Milestone C), after cutover step 0 and the fork rehearsal: pass --live-site (docs/runbooks/fork-rehearsal.md)"
  done
fi

# ---------------------------------------------------------------- which repository
echo
echo "swarm.press on one origin"
echo "  open        ${SWARMPRESS_PUBLIC_URL%/}/?central=1&llm=fake&ff=09:00"
if [ "$MODE" = fake ]; then
  echo "  GitHub      fake: in memory, nothing leaves this machine, lost when the server stops"
else
  if [ -n "${GITHUB_TOKEN:-}" ]; then echo "  GitHub      REAL, token mode"; else echo "  GitHub      REAL, GitHub App"; fi
fi
if [ -n "${SWARMPRESS_DEFAULT_SITE_REPO:-}" ]; then
  echo "  new company writes to   $SWARMPRESS_DEFAULT_SITE_REPO (base $BASE)"
else
  echo "  new company writes to   $ORG/<login>-site (base $BASE; no SWARMPRESS_DEFAULT_SITE_REPO)"
fi
echo "  allowed     ${SWARMPRESS_ALLOWED_SITE_REPOS:-any (fake GitHub without SWARMPRESS_ALLOWED_SITE_REPOS)}"
DB_URL=${DATABASE_URL:-sqlite://data/swarmpress.db?mode=rwc}
DB_FILE=${DB_URL#sqlite://}
DB_FILE=${DB_FILE#sqlite:}
DB_FILE=${DB_FILE%%\?*}
mismatch=0
if [ -f "$DB_FILE" ] && command -v sqlite3 >/dev/null; then
  rows=$(sqlite3 -readonly -separator '|' "$DB_FILE" \
    "SELECT u.login, c.name, c.site_repo, c.site_base_branch FROM companies c JOIN users u ON u.id = c.owner_user_id ORDER BY c.created_at" 2>/dev/null || true)
  if [ -n "$rows" ]; then
    echo "  existing companies ($DB_FILE) keep their own binding:"
    while IFS='|' read -r login name repo branch; do
      flag=""
      if ! allowed "$repo"; then flag="  << NOT ALLOWED: the gateway refuses it"; mismatch=1
      elif [ -n "${SWARMPRESS_DEFAULT_SITE_REPO:-}" ] && [ "$(lower "$repo")" != "$(lower "$SWARMPRESS_DEFAULT_SITE_REPO")" ]; then
        flag="  (not the default: rebind with PATCH /api/companies/me)"
      fi
      echo "    login=$login  \"$name\"  writes to $repo (base $branch)$flag"
    done <<< "$rows"
  fi
elif [ -f "$DB_FILE" ]; then
  echo "  existing companies: install sqlite3 to list their bindings ($DB_FILE)"
fi
[ "$mismatch" = 0 ] || echo "  A company outside the allow-list cannot write; rebind it (docs/runbooks/fork-rehearsal.md)."
echo

if [ "$MODE" = real ] && [ "$YES" != 1 ] && [ "$CHECK" != 1 ]; then
  [ -t 0 ] || die "a real GitHub: confirm on a terminal, or pass --yes"
  read -r -p "Start the server writing to ${SWARMPRESS_DEFAULT_SITE_REPO}? [y/N] " answer
  case "$answer" in y|Y|yes) ;; *) die "not started" ;; esac
fi

# ---------------------------------------------------------------- build and run
if [ "$BUILD" = 1 ]; then
  pnpm build
fi
profile=debug
cargo_flags=()
if [ "$RELEASE" = 1 ]; then profile=release; cargo_flags=(--release); fi
cargo build -p server --bin swarmpress-server ${cargo_flags[@]+"${cargo_flags[@]}"}
target=${CARGO_TARGET_DIR:-target}
case "$target" in /*) ;; *) target="$ROOT/$target" ;; esac
bin="$target/$profile/swarmpress-server"
[ -x "$bin" ] || die "$bin was not built"

if [ "$CHECK" != 1 ]; then
  exec "$bin"
fi

# --check: start, look, stop (only the process started here).
origin="http://127.0.0.1:$PORT"
"$bin" &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  curl -fsS "$origin/healthz" >/dev/null 2>&1 && break
  kill -0 "$pid" 2>/dev/null || die "the server exited (see its log above)"
  sleep 0.5
done
curl -fsS "$origin/healthz" >/dev/null || die "no answer on $origin/healthz"
fail=0
check() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=1; fi; }
headers=$(curl -fsS -D - -o /dev/null "$origin/")
spa=$(curl -fsS -D - -o /dev/null "$origin/play/deep/link?central=1")
check "the page is cross-origin isolated (COOP same-origin)" 'printf "%s" "$headers" | grep -qi "^cross-origin-opener-policy: same-origin"'
check "the page is cross-origin isolated (COEP)" 'printf "%s" "$headers" | grep -qi "^cross-origin-embedder-policy: "'
check "a deep link falls back to the page, isolated" 'printf "%s" "$spa" | grep -qi "^content-type: text/html" && printf "%s" "$spa" | grep -qi "^cross-origin-opener-policy: same-origin"'
check "the API answers on the same origin (/api/me: 401)" '[ "$(curl -s -o /dev/null -w "%{http_code}" "$origin/api/me")" = 401 ]'
if [ "$fail" = 0 ]; then echo "run-local: single-origin check passed"; else die "single-origin check failed"; fi
