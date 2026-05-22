#!/usr/bin/env bash
# Manual DB backup script using pg_dump.
# For automated daily backups, use Supabase's built-in PITR (Point-in-Time Recovery)
# in the Supabase dashboard under Project Settings → Database → Backups.
#
# Usage: DIRECT_URL="postgres://..." ./scripts/backup-db.sh
# Or:    ./scripts/backup-db.sh --restore backups/backup-2026-05-20.dump

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/backup-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

if [[ "${1:-}" == "--restore" ]]; then
    RESTORE_FILE="${2:?Usage: $0 --restore <file.dump>}"
    echo "⚠️  Restoring from $RESTORE_FILE — this will overwrite current data!"
    read -r -p "Type 'yes' to confirm: " confirm
    [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 1; }
    pg_restore --no-owner --no-acl -d "$DIRECT_URL" "$RESTORE_FILE"
    echo "✅ Restore complete."
    exit 0
fi

if [[ -z "${DIRECT_URL:-}" ]]; then
    echo "Error: DIRECT_URL environment variable is not set."
    echo "Use the direct Postgres URL (port 5432), not the PgBouncer URL."
    exit 1
fi

echo "📦 Starting backup to $BACKUP_FILE ..."
pg_dump --format=custom --no-acl --no-owner "$DIRECT_URL" -f "$BACKUP_FILE"
echo "✅ Backup complete: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Prune backups older than 30 days
find "$BACKUP_DIR" -name "backup-*.dump" -mtime +30 -delete
echo "🗑️  Pruned backups older than 30 days."
