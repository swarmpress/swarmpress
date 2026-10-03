#!/usr/bin/env bash
# Bind an existing company to another site repository or base branch
# (PATCH /api/companies/me, increment G2) on a server started by
# scripts/run-local.sh.
#
#   scripts/rebind-company.sh [--env FILE] [--login NAME] [--force] owner/name [base-branch]
#
#   --env FILE    the environment file the server runs with (default .env)
#   --login NAME  the dev login whose company is rebound (default ceo, the game's default)
#   --force       take the company lease over from the executor that holds it (an open
#                 game tab then goes read-only); without it a held lease is refused
#
# It signs in with the dev login (SWARMPRESS_DEV_AUTH=1, which a real GitHub
# allows on a loopback address only), takes the company lease as the device
# `cli-rebind`, sends the rebind and releases the lease. The server refuses a
# repository outside SWARMPRESS_ALLOWED_SITE_REPOS (403) and refuses while the
# company's gateway pull requests are open or a deploy is pending (409); the
# change is recorded as a SiteRebound event in the company's inbox. Reload the
# game afterwards: the boot screen and the HUD show the new binding.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

ENV_FILE=.env LOGIN=ceo MODE=acquire
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE=${2:?--env needs a file}; shift 2 ;;
    --login) LOGIN=${2:?--login needs a name}; shift 2 ;;
    --force) MODE=force; shift ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "rebind-company: unknown option $1 (see --help)" >&2; exit 2 ;;
    *) break ;;
  esac
done
REPO=${1:-}
BRANCH=${2:-}

die() { echo "rebind-company: $*" >&2; exit 1; }
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "usage: scripts/rebind-company.sh [--login NAME] [--force] owner/name [base-branch]"
[ -z "$BRANCH" ] || [[ "$BRANCH" =~ ^[A-Za-z0-9/._-]+$ ]] || die "$BRANCH is not a branch name"
[[ "$LOGIN" =~ ^[A-Za-z0-9_-]{1,39}$ ]] || die "--login must be 1-39 of [A-Za-z0-9_-]"
command -v curl >/dev/null || die "curl not found"
command -v node >/dev/null || die "node not found"

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
BIND=${SWARMPRESS_BIND:-127.0.0.1:8080}
ORIGIN="http://127.0.0.1:${BIND##*:}"

# `field path` reads one value from the JSON on stdin (empty when absent).
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v=null};for(const k of process.argv[1].split("."))v=v==null?v:v[k];process.stdout.write(v==null?"":typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }

JAR=$(mktemp "${TMPDIR:-/tmp}/swarmpress-rebind.XXXXXX")
BODY=$(mktemp "${TMPDIR:-/tmp}/swarmpress-rebind-body.XXXXXX")
TOKEN=""
COMPANY=""
cleanup() {
  if [ -n "$TOKEN" ] && [ -n "$COMPANY" ]; then
    curl -s -o /dev/null -b "$JAR" -X DELETE -H "x-swarmpress-lease: $TOKEN" "$ORIGIN/api/companies/$COMPANY/lease" || true
  fi
  rm -f "$JAR" "$BODY"
}
trap cleanup EXIT

# call METHOD PATH [JSON] [extra curl args...]: the body goes to $BODY, the status is printed.
call() {
  local method=$1 path=$2 json=$3
  shift 3
  if [ -n "$json" ]; then
    curl -s -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" -H 'content-type: application/json' --data "$json" "$@" "$ORIGIN$path"
  else
    curl -s -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" "$@" "$ORIGIN$path"
  fi
}
error_of() { field error < "$BODY"; }

curl -fsS -o /dev/null "$ORIGIN/healthz" || die "no server on $ORIGIN (start it with scripts/run-local.sh --env $ENV_FILE)"

code=$(call POST /auth/dev/login "{\"login\":\"$LOGIN\"}")
[ "$code" = 200 ] || die "dev login as $LOGIN: $code $(error_of) (needs SWARMPRESS_DEV_AUTH=1)"
code=$(call GET /api/companies/me "")
[ "$code" = 200 ] || die "$LOGIN has no company yet ($code): found it by opening the game once with login=$LOGIN"
COMPANY=$(field id < "$BODY")
echo "company   $(field name < "$BODY") ($COMPANY)"
echo "now       $(field site_repo < "$BODY") (base $(field site_base_branch < "$BODY"))"

code=$(call POST "/api/companies/$COMPANY/lease" "{\"device_id\":\"cli-rebind\",\"mode\":\"$MODE\"}")
if [ "$code" = 409 ]; then
  holder=$(field holder < "$BODY")
  die "the lease is held by $holder: close the game tab and wait for the lease to expire (SWARMPRESS_LEASE_SECS, default 90 s), or pass --force"
fi
[ "$code" = 200 ] || die "lease: $code $(error_of)"
TOKEN=$(field token < "$BODY")

if [ -n "$BRANCH" ]; then
  json="{\"site_repo\":\"$REPO\",\"base_branch\":\"$BRANCH\"}"
else
  json="{\"site_repo\":\"$REPO\"}"
fi
code=$(call PATCH /api/companies/me "$json" -H "x-swarmpress-lease: $TOKEN")
[ "$code" = 200 ] || die "rebind refused ($code): $(error_of)"
echo "bound to  $(field site_repo < "$BODY") (base $(field site_base_branch < "$BODY"))"
echo "Reload the game: the boot screen and the HUD show the binding."
