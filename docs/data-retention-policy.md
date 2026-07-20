# Data Retention Policy

Effective date: 2026-06-12

## Automated purges

| Data type | Retention | Mechanism |
|---|---|---|
| Password reset tokens | 7 days | `NotificationsService.purgeExpiredData()` daily cron (03:00 UTC) |
| Email verification tokens | Until used or 24h expiry | Deleted on successful verification |
| In-app notifications | 30 days | Daily purge cron |
| Audit logs | 90 days | Daily purge cron |
| AI assistant conversations | 180 days since last activity | Daily purge cron (messages cascade with the thread) |
| VPS database backups | 30 days | `scripts/vps-backup.sh` prune |
| Logical DB dumps (`scripts/backup-db.sh`) | 30 days | Script prune |

## Tenant business data

Sales, purchases, inventory, accounting, and CRM records are retained for the life of the tenant subscription unless the tenant requests deletion.

## Data subject requests

- **Export:** `GET /api/v1/account/data-export` (authenticated user)
- **Deletion request:** `DELETE /api/v1/account/data-deletion-request` logs the request for manual review within 30 days

## Legal holds

Audit and billing events related to payment disputes may be retained beyond the standard audit-log window when flagged by platform administrators.