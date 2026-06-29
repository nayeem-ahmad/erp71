#!/usr/bin/env bash
# Daily logical backup for the VPS Postgres container in docker-compose.prod.yml.
#
# Install on the VPS (runs as root at 02:30 daily):
#   install -m 0755 /opt/erp71/scripts/vps-backup.sh /usr/local/bin/erp71-backup
#   echo '30 2 * * * /usr/local/bin/erp71-backup >> /var/log/erp71-backup.log 2>&1' | crontab -
#
# Manual run:
#   cd /opt/erp71 && ./scripts/vps-backup.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/erp71}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp71}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="${BACKUP_DIR}/erp71-${TIMESTAMP}.dump"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-erp71}"

echo "[$(date -Is)] Starting VPS backup → ${BACKUP_FILE}"

docker compose -p "${COMPOSE_PROJECT:-erp71}" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump --format=custom --no-acl --no-owner \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$BACKUP_FILE"

echo "[$(date -Is)] Backup complete ($(du -sh "$BACKUP_FILE" | cut -f1))"

find "$BACKUP_DIR" -name 'erp71-*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -Is)] Pruned backups older than ${RETENTION_DAYS} days."