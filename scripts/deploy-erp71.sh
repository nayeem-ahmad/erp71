#!/usr/bin/env bash
# Deploy (or update) the ERP71 instance at app.erp71.com on the shared VPS.
# Requires the primary stack (retail-saas-db-1 + hermes Caddy) to be running.
set -euo pipefail

BRANCH="${1:-dev}"
COMPOSE_FILE="docker-compose.erp71.yml"
ENV_FILE=".env.erp71"
PROJECT="erp71"
CADDY_FILE="/opt/hermes/caddy/Caddyfile"
PRIMARY_ENV="/opt/retail-saas/.env.production"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: $COMPOSE_FILE not found in $REPO_ROOT" >&2
  exit 1
fi

echo "==> Fetching origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$PRIMARY_ENV" ]; then
    echo "ERROR: neither $ENV_FILE nor $PRIMARY_ENV exists — create $ENV_FILE first." >&2
    exit 1
  fi
  echo "==> Creating $ENV_FILE from primary production env"
  cp "$PRIMARY_ENV" "$ENV_FILE"
  ERP71_DB_PASSWORD="$(openssl rand -hex 24)"
  ERP71_JWT_SECRET="$(openssl rand -hex 48)"
  ERP71_FIELD_KEY="$(openssl rand -hex 32)"
  ERP71_DB_USER="erp71_app"
  ERP71_DB_NAME="erp71_retail_saas"
  sed -i \
    -e 's|^FRONTEND_URL=.*|FRONTEND_URL=https://app.erp71.com|' \
    -e 's|^BACKEND_PUBLIC_URL=.*|BACKEND_PUBLIC_URL=https://api.erp71.com|' \
    -e 's|^NEXT_PUBLIC_API_BASE=.*|NEXT_PUBLIC_API_BASE=https://api.erp71.com|' \
    -e 's|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=https://api.erp71.com|' \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${ERP71_JWT_SECRET}|" \
    -e "s|^FIELD_ENCRYPTION_KEY=.*|FIELD_ENCRYPTION_KEY=${ERP71_FIELD_KEY}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${ERP71_DB_USER}:${ERP71_DB_PASSWORD}@retail-saas-db-1:5432/${ERP71_DB_NAME}|" \
    -e "s|^DIRECT_URL=.*|DIRECT_URL=postgresql://${ERP71_DB_USER}:${ERP71_DB_PASSWORD}@retail-saas-db-1:5432/${ERP71_DB_NAME}|" \
    -e 's|https://app\.nayeemahmad\.com|https://app.erp71.com|g' \
    -e 's|https://api\.nayeemahmad\.com|https://api.erp71.com|g' \
    "$ENV_FILE"
  sed -i '/^POSTGRES_/d' "$ENV_FILE"
  grep -q '^ERP71_DB_NAME=' "$ENV_FILE" || echo "ERP71_DB_NAME=${ERP71_DB_NAME}" >> "$ENV_FILE"
  grep -q '^ERP71_DB_USER=' "$ENV_FILE" || echo "ERP71_DB_USER=${ERP71_DB_USER}" >> "$ENV_FILE"
  grep -q '^ERP71_DB_PASSWORD=' "$ENV_FILE" || echo "ERP71_DB_PASSWORD=${ERP71_DB_PASSWORD}" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "==> Wrote $ENV_FILE — review PLATFORM_ADMIN_EMAILS and billing redirect URLs if needed."
fi

if ! grep -q 'retail-saas-db-1' "$ENV_FILE"; then
  echo "ERROR: $ENV_FILE DATABASE_URL must use host retail-saas-db-1" >&2
  exit 1
fi

ERP71_DB_USER="$(grep -E '^ERP71_DB_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
ERP71_DB_PASSWORD="$(grep -E '^ERP71_DB_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
ERP71_DB_NAME="$(grep -E '^ERP71_DB_NAME=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"

if [ -z "$ERP71_DB_USER" ] || [ -z "$ERP71_DB_PASSWORD" ] || [ -z "$ERP71_DB_NAME" ]; then
  echo "ERROR: $ENV_FILE must define ERP71_DB_USER, ERP71_DB_PASSWORD, ERP71_DB_NAME" >&2
  exit 1
fi

PG_SUPERUSER="$(grep -E '^POSTGRES_USER=' "$PRIMARY_ENV" | tail -1 | cut -d= -f2-)"
if [ -z "$PG_SUPERUSER" ]; then
  PG_SUPERUSER=postgres
fi

echo "==> Ensuring Postgres role and database exist (superuser: ${PG_SUPERUSER})"
docker exec retail-saas-db-1 psql -U "$PG_SUPERUSER" -d postgres -tc \
  "SELECT 1 FROM pg_roles WHERE rolname = '${ERP71_DB_USER}'" | grep -q 1 \
  || docker exec retail-saas-db-1 psql -U "$PG_SUPERUSER" -d postgres -c \
  "CREATE ROLE ${ERP71_DB_USER} WITH LOGIN PASSWORD '${ERP71_DB_PASSWORD}';"

docker exec retail-saas-db-1 psql -U "$PG_SUPERUSER" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = '${ERP71_DB_NAME}'" | tr -d '[:space:]' | grep -q '^1$' \
  || docker exec retail-saas-db-1 psql -U "$PG_SUPERUSER" -d postgres -c \
  "CREATE DATABASE ${ERP71_DB_NAME} OWNER ${ERP71_DB_USER};" 2>/dev/null \
  || true

echo "==> Building erp71 images"
docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build

echo "==> Syncing database schema and seeding"
docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm backend sh -lc \
  'npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate --accept-data-loss && npx tsx packages/database/prisma/seed.ts'

echo "==> Starting erp71 stack"
docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

if [ -f "$CADDY_FILE" ]; then
  if ! grep -q 'app.erp71.com' "$CADDY_FILE"; then
    echo "==> Adding erp71.com blocks to $CADDY_FILE"
    cat >> "$CADDY_FILE" <<'CADDY'

erp71.com {
	redir https://app.erp71.com{uri}
}

app.erp71.com {
	encode zstd gzip
	reverse_proxy erp71-frontend-1:3000
}

api.erp71.com {
	encode zstd gzip
	reverse_proxy erp71-backend-1:4000
}
CADDY
    docker exec hermes-webui-proxy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
      || docker exec hermes-caddy-1 caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
      || true
  else
    echo "==> Caddy already has erp71.com blocks — skipping"
  fi
else
  echo "WARN: $CADDY_FILE not found — add reverse_proxy blocks for erp71 manually." >&2
fi

echo "==> Smoke checks"
curl -sf "https://api.erp71.com/api/v1/health" && echo ""
curl -sf -o /dev/null -w "app.erp71.com HTTP %{http_code}\n" "https://app.erp71.com/"

echo "Done. erp71 is live at https://app.erp71.com"