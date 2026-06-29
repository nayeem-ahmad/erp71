#!/usr/bin/env bash
# One-time VPS cutover: retail-saas → erp71 paths, compose project, and Caddy targets.
# Run on the VPS as root during a maintenance window.
#
# Usage: ssh root@<vps> 'bash -s' < scripts/migrate-vps-rename.sh
set -euo pipefail

OLD_DIR="/opt/retail-saas"
NEW_DIR="/opt/erp71"
CADDY_FILE="${CADDY_FILE:-/etc/caddy/Caddyfile}"

if [ -d "$NEW_DIR" ] && [ ! -d "$OLD_DIR" ]; then
  echo "Already migrated ($NEW_DIR exists, $OLD_DIR absent)."
  exit 0
fi

if [ ! -d "$OLD_DIR" ]; then
  echo "ERROR: $OLD_DIR not found — nothing to migrate." >&2
  exit 1
fi

echo "==> Stopping old stack"
cd "$OLD_DIR"
docker compose -p retail-saas -f docker-compose.prod.yml down || true

echo "==> Moving $OLD_DIR → $NEW_DIR"
mv "$OLD_DIR" "$NEW_DIR"
cd "$NEW_DIR"

if [ -f "$CADDY_FILE" ]; then
  echo "==> Updating Caddy reverse_proxy targets"
  sed -i \
    -e 's/retail-saas-frontend-1/erp71-frontend-1/g' \
    -e 's/retail-saas-backend-1/erp71-backend-1/g' \
    "$CADDY_FILE"
  systemctl reload caddy 2>/dev/null || docker exec hermes-caddy-1 caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
fi

if crontab -l 2>/dev/null | grep -q retail-saas-backup; then
  echo "==> Updating backup cron"
  (crontab -l 2>/dev/null | sed \
    -e 's|/opt/retail-saas|/opt/erp71|g' \
    -e 's/retail-saas-backup/erp71-backup/g' \
    -e 's|/var/log/retail-saas-backup|/var/log/erp71-backup|g') | crontab -
fi

if [ -f /usr/local/bin/retail-saas-backup ]; then
  install -m 0755 "$NEW_DIR/scripts/vps-backup.sh" /usr/local/bin/erp71-backup
  rm -f /usr/local/bin/retail-saas-backup
fi

echo "==> Starting erp71 stack"
./scripts/deploy.sh main

echo "Done. Verify: curl -sf https://api.erp71.com/api/v1/health"