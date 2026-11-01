#!/usr/bin/env bash
# Server-side steps of docs/performance/perceived-speed-plan.md that live on the
# VPS rather than in the repo. Run by a person, one step at a time, from a
# checkout of this repo:
#
#   ssh root@66.116.236.127 'bash -s' -- <step> < scripts/ops/perf-server-steps.sh
#
# Steps (each is idempotent and prints how to undo it):
#
#   caddy-app-api-route  P1.1  app.erp71.com/api/v1/* straight to the backend.
#                              MUST be live before the release that points the
#                              browser at its own origin for the API.
#   metrics-token        P1.6  Adds METRICS_TOKEN to .env.production. Takes
#                              effect on the next deploy.
#   db-pool              P3.2  Adds connection_limit/pool_timeout to
#                              DATABASE_URL. Takes effect on the next deploy.
#   pg-tune              P3.2  Postgres settings that apply without a restart,
#                              plus shared_buffers/pg_stat_statements queued for
#                              the next restart. No downtime.
#   pg-restart           P3.2  Restarts the Postgres container so the queued
#                              settings apply, then creates pg_stat_statements.
#                              ~5-10 s of DB downtime for erp71 AND profiles71
#                              (same container). Quiet hours only.
#   status                     Read-only: shows what is applied.

set -euo pipefail

STEP="${1:-status}"
CADDYFILE=/opt/erp71/Caddyfile
CADDY_CONTAINER=erp71-caddy-1
CADDY_IMAGE=caddy:2.9-alpine
ENV_FILE=/opt/erp71/.env.production
DB_CONTAINER=erp71-db-1
TS="$(date +%Y%m%d-%H%M%S)"

psql_db() {
    docker exec -i "$DB_CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
}

caddy_app_api_route() {
    echo "already applied: app.erp71.com /api/v1/* lives in the git Caddyfile ($CADDYFILE),"
    echo "served by $CADDY_CONTAINER. Do not edit Hermes. To reload after a Caddyfile"
    echo "edit, run scripts/deploy.sh, or the sync_caddy_config wrapper in"
    echo "docs/ops/shared-vps-second-app.md (it defines compose() first)."
    return 0
}

metrics_token() {
    if grep -q '^METRICS_TOKEN=.\+' "$ENV_FILE"; then
        echo "already set: METRICS_TOKEN"
        return 0
    fi
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$TS"
    printf '\n# Prometheus scrape token for /api/v1/metrics (perceived-speed plan P1.6)\nMETRICS_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$ENV_FILE"
    echo "METRICS_TOKEN added. It takes effect on the next deploy."
    echo "read it: docker exec erp71-backend-1 node -e 'fetch(\"http://localhost:4000/api/v1/metrics\",{headers:{Authorization:\"Bearer \"+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.slice(0,500)))'"
    echo "undo: restore $ENV_FILE.bak-$TS"
}

db_pool() {
    if grep -q '^DATABASE_URL=.*connection_limit=' "$ENV_FILE"; then
        echo "already set: DATABASE_URL has connection_limit"
        return 0
    fi
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$TS"
    python3 - "$ENV_FILE" <<'EOF'
import sys
p = sys.argv[1]
lines = open(p).read().split("\n")
for i, line in enumerate(lines):
    if line.startswith("DATABASE_URL="):
        value = line[len("DATABASE_URL="):]
        quote = value[0] if value[:1] in ("'", '"') else ""
        bare = value.strip("'\"")
        sep = "&" if "?" in bare else "?"
        lines[i] = "DATABASE_URL=" + quote + bare + sep + "connection_limit=15&pool_timeout=20" + quote
        break
else:
    sys.exit("DATABASE_URL not found")
open(p, "w").write("\n".join(lines))
EOF
    echo "DATABASE_URL now carries connection_limit=15&pool_timeout=20. It takes effect on the next deploy."
    echo "undo: restore $ENV_FILE.bak-$TS"
}

pg_tune() {
    # Refuse to queue a preload library the image does not ship: Postgres would
    # not start again after the next restart.
    docker exec "$DB_CONTAINER" sh -c 'ls "$(pg_config --pkglibdir)/pg_stat_statements.so"' >/dev/null

    psql_db <<'SQL'
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET effective_cache_size = '4GB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET track_io_timing = on;
-- These two need a restart (step pg-restart); they wait in postgresql.auto.conf.
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
SELECT pg_reload_conf();
SQL
    sleep 1
    echo "settings now (pending_restart=t applies at the next restart):"
    echo "SELECT name, setting, unit, pending_restart FROM pg_settings WHERE name IN ('work_mem','effective_cache_size','random_page_cost','track_io_timing','shared_buffers','shared_preload_libraries') ORDER BY name;" | psql_db
    echo "undo: ALTER SYSTEM RESET <name>; SELECT pg_reload_conf();  (ALTER SYSTEM RESET ALL resets everything)"
}

pg_restart() {
    # `docker restart`, never `docker compose up` for the db: the container is
    # also attached by hand to retail-saas_default (alias retail-saas-db-1) for
    # profiles71, and recreating it would drop that attachment.
    echo "restarting $DB_CONTAINER (erp71 + profiles71 lose the DB for a few seconds)"
    docker restart "$DB_CONTAINER" >/dev/null
    for _ in $(seq 1 60); do
        if docker exec "$DB_CONTAINER" sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    echo "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" | psql_db
    echo "SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','shared_preload_libraries');" | psql_db
    docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{$v.Aliases}}{{"\n"}}{{end}}' "$DB_CONTAINER"
    curl -s https://api.erp71.com/api/v1/health; echo
}

status() {
    echo "== Caddy app.erp71.com /api/v1 route"
    grep -q 'handle /api/v1/\*' "$CADDYFILE" && echo "applied" || echo "not applied"
    echo "== METRICS_TOKEN"
    grep -q '^METRICS_TOKEN=.\+' "$ENV_FILE" && echo "set" || echo "not set"
    echo "== DATABASE_URL pool"
    grep -q '^DATABASE_URL=.*connection_limit=' "$ENV_FILE" && echo "set" || echo "not set"
    echo "== Postgres"
    echo "SELECT name || '=' || setting || coalesce(unit,'') || CASE WHEN pending_restart THEN ' (pending restart)' ELSE '' END FROM pg_settings WHERE name IN ('work_mem','effective_cache_size','random_page_cost','shared_buffers','shared_preload_libraries') ORDER BY name;" | psql_db
    echo "SELECT 'pg_stat_statements installed=' || count(*) FROM pg_extension WHERE extname='pg_stat_statements';" | psql_db
}

case "$STEP" in
    caddy-app-api-route) caddy_app_api_route ;;
    metrics-token) metrics_token ;;
    db-pool) db_pool ;;
    pg-tune) pg_tune ;;
    pg-restart) pg_restart ;;
    status) status ;;
    *) echo "unknown step: $STEP" >&2; exit 2 ;;
esac
