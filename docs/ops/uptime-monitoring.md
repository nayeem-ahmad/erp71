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
   - URL: `https://your-backend.onrender.com/health`
   - Check interval: **1 minute**
   - Alert on: status not `ok` OR HTTP status ≠ 200
3. Add a second monitor for the frontend:
   - URL: `https://your-frontend.onrender.com/`
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

## Render Alerts (#59)

In Render Dashboard → each service → **Notifications**:
- Enable: Deploy failed, Service suspended, Service crashed
- Webhook: add Slack webhook URL for real-time alerts

---

## DB Connection Exhaustion Alert

In Supabase Dashboard → Observability → Alerts:
- Add alert: **Active connections > 80%** of pool size → notify via email

---

## Quick Status Check (CLI)

```bash
# Backend health
curl -s https://your-backend.onrender.com/health | python3 -m json.tool

# DB connection count
psql $DIRECT_URL -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"
```
