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

# --env-file makes Compose use .env.production for variable interpolation
# (frontend build args like NEXT_PUBLIC_API_URL and the db service's POSTGRES_*),
# not just for container runtime env. Without it the build fails and the db
# initializes with default credentials.
COMPOSE_PROJECT="${COMPOSE_PROJECT:-erp71}"

echo "==> Building and starting the stack (project: $COMPOSE_PROJECT)"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo "==> Current status"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
