# VPS Database Backups

Production at `app.nayeemahmad.com` runs Postgres in the `db` Docker container (`docker-compose.prod.yml`).

## Automated daily backups

```bash
cd /opt/erp71
chmod +x scripts/vps-backup.sh
install -m 0755 scripts/vps-backup.sh /usr/local/bin/erp71-backup
(crontab -l 2>/dev/null; echo '30 2 * * * /usr/local/bin/erp71-backup >> /var/log/erp71-backup.log 2>&1') | crontab -
```

Backups are written to `/var/backups/erp71/` and pruned after 30 days.

## Manual backup

```bash
cd /opt/erp71
./scripts/vps-backup.sh
```

## Restore

```bash
BACKUP=/var/backups/erp71/erp71-2026-06-12_02-30-00.dump
cd /opt/erp71
source .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  pg_restore --clean --if-exists --no-owner --no-acl \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$BACKUP"
```

> Stop the backend before restoring if you need a consistent snapshot.

## Render / Supabase backups

For Render-hosted databases, enable PITR in the provider dashboard and use `scripts/backup-db.sh` for on-demand logical dumps:

```bash
DIRECT_URL="postgres://..." ./scripts/backup-db.sh
```