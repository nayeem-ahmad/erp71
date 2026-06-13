# System Health Alerting

How platform admins get notified when the platform is unhealthy. Implements
Phase 4 of `system-health-monitoring-plan.md`.

## Two alerting paths

### 1. Sentry (errors & APM)
Sentry is already wired (`apps/backend/src/instrument.ts`; payment errors tagged
`domain:payment`). Configure these alert rules in the Sentry project UI
(Alerts → Create Alert):

| Rule | Condition | Notify |
|---|---|---|
| Error-rate spike | Issue frequency > 50 events / 1h, or a new issue with > 10 events / 5m | Platform on-call |
| Payment failures | New/regressed issue where `domain` equals `payment` | Platform on-call (high priority) |
| DB connection errors | Issue message matches `pool`/`ECONNREFUSED`/`too many connections` | Platform on-call |

These live in Sentry config, not the codebase.

### 2. In-app threshold alerting
`HealthAlertService` (`apps/backend/src/system-health/alerts/`) runs every 5
minutes (tracked as the `system-health.evaluate-alerts` job). It pulls the
aggregated health report and:

- **Alerts** when overall status is `degraded` or `down`. The report rolls up
  deep checks (DB pool/latency, Redis, external providers, cron jobs) **plus**
  the payment-webhook-failure and SMS-credit-low signals.
- Sends **at most one alert per cooldown window** while unhealthy
  (`HEALTH_ALERT_COOLDOWN_MIN`, default 30m), then repeats once per window.
- Sends a **single recovery notice** when status returns to `ok`.
- Delivery is best-effort: a failing channel is logged, never thrown.

When no recipients are configured, the degradation is logged (WARN/ERROR) only.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `HEALTH_ALERT_EMAILS` | — | Comma-separated alert recipients (required for email) |
| `HEALTH_ALERT_SMS` | — | Optional comma-separated phone numbers (platform-billed) |
| `HEALTH_ALERT_COOLDOWN_MIN` | `30` | Minimum minutes between repeat alerts |
| `HEALTH_PAYMENT_FAILURE_THRESHOLD` | `3` | FAILED billing events in window → degraded |
| `HEALTH_PAYMENT_FAILURE_WINDOW_MIN` | `60` | Payment-failure look-back window |
| `SMS_CREDIT_LOW_THRESHOLD` | `100` | A tenant at/below this credit count is "low" |
| `SMS_CREDIT_LOW_TENANTS_ALERT` | `5` | Low-credit tenant count that → degraded |

## What feeds an alert

- **DB** down → status `down` → alert. Pool saturation / high latency → `degraded`.
- **External provider** (bKash, Nagad, SSLCommerz, BulkSMSBD, Resend,
  Cloudinary, Supabase) unreachable → `degraded`.
- **Cron job** failed or overdue → `degraded`.
- **Payment webhooks**: ≥ `HEALTH_PAYMENT_FAILURE_THRESHOLD` FAILED billing
  events within the window → `degraded`.
- **SMS credit**: ≥ `SMS_CREDIT_LOW_TENANTS_ALERT` active tenants at/below
  `SMS_CREDIT_LOW_THRESHOLD` credits → `degraded`.

## Verifying

Force a degraded state (e.g. point an external provider URL at an unreachable
host, or temporarily lower `HEALTH_PAYMENT_FAILURE_THRESHOLD` to `0`) and
confirm exactly one alert arrives, repeats only after the cooldown, and a
recovery notice follows once healthy. The live report is always at
`GET /api/v1/admin/system-health` (platform admin).
