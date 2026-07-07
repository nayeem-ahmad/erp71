# Uptime Monitoring Setup (#58 + #59)

## Health Check Endpoint

The backend exposes `GET /health` returning:
```json
{
  "status": "ok",
  "db": "ok",
  "uptime": 3600,
  "latency_ms": 4,
  "timestamp": "2026-05-20T08:00:00.000Z"
}
```
Returns `"status": "degraded"` if the DB is unreachable. Configure your uptime monitor to alert on non-`ok` status.

---

## BetterStack Setup (Recommended)

1. Sign up at https://betterstack.com/uptime
2. **Add Monitor** → HTTP monitor
   - URL: `https://api.nayeemahmad.com/api/v1/health`
   - Check interval: **1 minute**
   - Alert on: status not `ok` OR HTTP status ≠ 200
3. Add a second monitor for the frontend:
   - URL: `https://app.nayeemahmad.com/`
   - Check interval: **1 minute**
4. Set up **escalation policy**: notify via email immediately, then SMS after 5 min if unacknowledged
5. Connect to your **status page** (BetterStack provides this free)

---

## Sentry Alerts (#59)

In Sentry dashboard, set up these alert rules:

| Alert | Condition | Action |
|---|---|---|
| Error spike | Error rate > 10/min (any issue) | Email + Slack |
| Payment error | Issue tagged `payment` created | Email immediately |
| New issue | Any unhandled exception first seen | Email |

To tag payment-related errors, add to billing service:
```typescript
Sentry.captureException(error, { tags: { domain: 'payment' } });
```

---

## VPS / Container Alerts (#59)

Production runs on a self-managed VPS (Docker Compose + Caddy), so there is no Render dashboard. Cover deploy/crash/uptime alerting two ways:

- **External uptime monitor** (BetterStack or equivalent) hitting the live endpoints — alert on non-200 / non-`ok`:
  - `https://api.erp71.com/api/v1/health`
  - `https://app.erp71.com`
- **Container health on the VPS** — check that all services are up:
  ```bash
  ssh root@66.116.236.127 'cd /opt/erp71 && docker compose -p erp71 -f docker-compose.prod.yml ps'
  ```
  Any container not in `Up`/`healthy` state means a crashed or restarting service. Wire this into a cron/monitor if you want proactive alerts.

---

## DB Connection Exhaustion Alert

In Supabase Dashboard → Observability → Alerts:
- Add alert: **Active connections > 80%** of pool size → notify via email

---

## Quick Status Check (CLI)

```bash
# Backend health (production VPS)
./scripts/smoke-check.sh

# Or manually:
curl -s https://api.nayeemahmad.com/api/v1/health | python3 -m json.tool

# DB connection count
psql $DIRECT_URL -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"
```
