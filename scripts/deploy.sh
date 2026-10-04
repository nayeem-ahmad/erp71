#!/usr/bin/env bash
# Manual deploy helper for the VPS. Pulls the latest code and (re)builds the
# production stack. Idempotent — safe to re-run.
#
# The order is what keeps the outage short. Building the images and preparing
# the database both happen while the old containers keep serving; only then
# are containers swapped, and the new backend's start is just Nest booting.
# Before this, all of that preparation ran inside the new container's start
# command, after the old one was gone: 19-24 s of 502s per deploy, measured on
# #766 (P3.5 in docs/performance/perceived-speed-plan.md).
#
# A failure while building or preparing aborts with nothing swapped, so the old
# version keeps serving and the deploy workflow goes red.
set -euo pipefail

BRANCH="${1:-main}"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

# Resolve repo root regardless of where the script is called from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found in $REPO_ROOT — create it before deploying." >&2
  exit 1
fi

echo "==> Fetching origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Syncing erp71.com URLs in $ENV_FILE"
bash "$REPO_ROOT/scripts/sync-erp71-env-urls.sh" "$ENV_FILE"

# --env-file makes Compose use .env.production for variable interpolation
# (frontend build args like NEXT_PUBLIC_API_URL and the db service's POSTGRES_*),
# not just for container runtime env. Without it the build fails and the db
# initializes with default credentials.
COMPOSE_PROJECT="${COMPOSE_PROJECT:-erp71}"

compose() {
  docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# Bake the deployed commit into the images (backend GIT_SHA build arg) so the
# running app can report exactly what is live. Shell env overrides --env-file
# for Compose interpolation, so this wins without touching .env.production.
# It is also the key of the "database prepared" marker (see below).
GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA

# 1. Build. Every service with a build: section, as `up -d --build` used to.
#    The old containers keep serving; a failed build stops here (set -e).
echo "==> Building images (project: $COMPOSE_PROJECT, commit: $GIT_SHA)"
compose build

# 2. Prepare the database for the new commit, in a one-off container from the
#    image just built, while the old backend is still serving.
#
#    db-prepare.sh is the schema sync (db push), the platform catalog and every
#    sync:* back-fill, in the order its comments explain. On success it leaves
#    a marker for $GIT_SHA on the backend_state volume; the new backend finds
#    it on start and skips straight to listening. Without the marker (a plain
#    `up -d`, a rollback) the backend prepares itself first — correct, just
#    the old slow start.
#
#    Safe to run under the old code because every sync:* step and every
#    `db push` change has been additive and idempotent: the old backend keeps
#    working against the new schema for the seconds until the swap.
#    db-prepare.sh passes `--accept-data-loss` to db push, which is where that
#    assumption is made explicit — a release that drops or renames a column the
#    old code reads would make the old container error in this window, as it
#    would have at its first request after a swap.
#
#    --no-deps: the prepare needs Postgres and nothing else, and must not touch
#    the running backend. So bring Postgres up first — a no-op when it already
#    is, which is every deploy but the first. -T: there is no terminal when the
#    deploy workflow runs this over SSH.
compose up -d --wait db

echo "==> Preparing the database for $GIT_SHA (the old backend is still serving)"
if ! compose run --rm --no-deps -T backend sh apps/backend/scripts/db-prepare.sh; then
  echo "DEPLOY ABORTED: the database prepare failed (see the 'db-prepare: FAILED' line above)." >&2
  echo "Nothing was swapped; the old containers are still serving." >&2
  echo "Fix the cause and re-run the deploy. Do not run 'up -d' by hand: the new" >&2
  echo "backend would retry the same prepare at start, and if it fails again, never boot." >&2
  exit 1
fi

# 3. Swap. Compose recreates the containers whose image changed; the new
#    backend's start command finds the marker from step 2.
echo "==> Starting the new containers"
compose up -d

# 4. Wait for the new backend to report healthy (the healthcheck in
#    docker-compose.prod.yml). Normally a few seconds of Nest boot; the timeout
#    also covers a backend that found no marker and is preparing itself
#    (start_period + retries × interval, with room to spare).
backend_container_state() {
  docker inspect -f '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null \
    || echo 'gone 0 none'
}

wait_for_backend_healthy() {
  local timeout="${BACKEND_HEALTH_TIMEOUT:-360}" waited=0
  local cid status restarts health baseline

  cid="$(compose ps -a -q backend)"
  cid="${cid%%$'\n'*}"
  if [ -z "$cid" ]; then
    echo "ERROR: no backend container after 'up -d'." >&2
    return 1
  fi
  # A fresh container starts at 0, but a redeploy of an unchanged image keeps
  # the old container and its history, so only count restarts from here on.
  read -r status baseline health <<<"$(backend_container_state "$cid")"

  while :; do
    read -r status restarts health <<<"$(backend_container_state "$cid")"

    if [ "$restarts" != "$baseline" ]; then
      echo "ERROR: the backend crashed and was restarted while starting up." >&2
      return 1
    fi
    case "$status/$health" in
      running/healthy)
        echo "==> Backend healthy after ${waited}s"
        return 0
        ;;
      running/none)
        echo "WARN: the backend has no healthcheck; not waiting for it." >&2
        return 0
        ;;
      */unhealthy)
        echo "ERROR: the backend is unhealthy." >&2
        return 1
        ;;
      running/*) ;;
      *)
        echo "ERROR: the backend container is '$status'." >&2
        return 1
        ;;
    esac

    if [ "$waited" -ge "$timeout" ]; then
      echo "ERROR: the backend was still '$health' after ${timeout}s." >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

# Shared-host VPS: Hermes Caddy must share the compose network to reach
# erp71-frontend-1 / erp71-backend-1 (otherwise app.erp71.com returns 502).
ERP71_NETWORK="${COMPOSE_PROJECT}_default"
attach_caddy() {
  local caddy running
  # Read once, then match: piping `docker ps` into `grep -q` under pipefail
  # can report a match as a failure when grep exits before docker finishes.
  running="$(docker ps --format '{{.Names}}')"
  for caddy in hermes-webui-proxy hermes-caddy-1; do
    if grep -qx "$caddy" <<<"$running"; then
      echo "==> Attaching $caddy to $ERP71_NETWORK"
      docker network connect "$ERP71_NETWORK" "$caddy" 2>/dev/null || true
    fi
  done
}

echo "==> Waiting for the new backend to report healthy"
if ! wait_for_backend_healthy; then
  # Attach anyway: whatever is up (the frontend, at least) must stay reachable
  # while someone looks at this.
  attach_caddy
  echo "==> Last backend log lines" >&2
  compose logs --tail=80 backend >&2 || true
  compose ps >&2 || true
  echo "DEPLOY FAILED: the new backend did not come up healthy. The old one is already gone;" >&2
  echo "fix forward or roll back (docs/ops/deployment-runbook.md, Rollback Procedure)." >&2
  exit 1
fi

attach_caddy

# Keep Docker's build cache from filling the disk. The VPS root sat at 81%
# with build cache most of what was reclaimable, and every deploy adds a full
# set of layers. 8GB keeps the recent ones, so the next build — or a rollback
# rebuild — still finds npm ci and the base images cached. Build cache only:
# no image or container is touched, running or not. The cache is shared by
# every app on this host, so this trims theirs too, least recently used first.
#
# The flag depends on the Docker version. Newer CLIs (buildx 0.17+ behind
# `docker builder`) renamed --keep-storage and map it to --reserved-space,
# which their help calls space the cache is "always allowed to keep": a floor.
# The cap meant here is --max-used-space where the CLI has it, and
# --keep-storage, which meant exactly that, where it does not.
#
# The deploy has already succeeded by now, so a failed prune only warns.
prune_build_cache() {
  local help
  help="$(docker builder prune --help 2>&1 || true)"
  case "$help" in
    *--max-used-space*) docker builder prune -f --max-used-space 8GB ;;
    *) docker builder prune -f --keep-storage 8GB ;;
  esac
}
echo "==> Pruning Docker build cache down to 8GB"
prune_build_cache || echo "WARN: build cache prune failed; the deploy itself succeeded." >&2

echo "==> Current status"
compose ps
