#!/usr/bin/env bash
# Manual deploy helper for the VPS. Pulls the latest code and (re)builds the
# production stack. Idempotent — safe to re-run.
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

# Bake the deployed commit into the images (backend GIT_SHA build arg) so the
# running app can report exactly what is live. Shell env overrides --env-file
# for Compose interpolation, so this wins without touching .env.production.
GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA

echo "==> Building and starting the stack (project: $COMPOSE_PROJECT, commit: $GIT_SHA)"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

# Shared-host VPS: Hermes Caddy must share the compose network to reach
# erp71-frontend-1 / erp71-backend-1 (otherwise app.erp71.com returns 502).
ERP71_NETWORK="${COMPOSE_PROJECT}_default"
for caddy in hermes-webui-proxy hermes-caddy-1; do
  if docker ps --format '{{.Names}}' | grep -qx "$caddy"; then
    echo "==> Attaching $caddy to $ERP71_NETWORK"
    docker network connect "$ERP71_NETWORK" "$caddy" 2>/dev/null || true
  fi
done

echo "==> Current status"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
