# System Health Monitoring — Dev-Ready Implementation Plan

**Status:** Proposed
**Owner:** Platform / Backend
**Branch:** `claude/system-health-monitoring-enw9k2`
**Last updated:** 2026-06-13

---

## 1. Goal

Give **platform admins** (users with `User.is_platform_admin = true`, gated by
`PlatformAdminGuard`) a reliable, real-time view of whether the system is
healthy, plus automated alerting when it is not. Today we have error tracking
(Sentry), structured logs (Winston), a shallow `GET /api/v1/health`, and a
business-metrics endpoint (`GET /api/v1/admin/metrics`). This plan closes the
operational-health gaps: deep dependency checks, runtime metrics, cron-job
observability, external-provider health, and a platform-admin dashboard.

### Non-goals
- Replacing Sentry (it stays as the error/APM backbone).
- Standing up self-hosted Prometheus/Grafana infra (we expose a metrics
  endpoint; scraping infra is a separate ops decision — see Phase 3 note).
- Per-tenant analytics dashboards (that's the existing `admin/metrics` surface).

---

## 2. Parameters to monitor (the "what")

Grouped by layer, with the signal and where it comes from.

### 2.1 Application / API runtime
| Parameter | Signal | Source |
|---|---|---|
| 5xx error rate | % of responses ≥ 500 over window | Sentry + metrics interceptor |
| Request latency p50/p95/p99 | per-route histogram | metrics interceptor |
| Throughput (req/min) | counter | metrics interceptor |
| Rate-limit rejections (429s) | counter | `@nestjs/throttler` + interceptor |
| Event-loop lag | ms | `perf_hooks` monitor |
| Heap / RSS memory | bytes | `process.memoryUsage()` |
| Process uptime / restarts | seconds, restart count | `process.uptime()` |
| Unhandled exceptions/rejections | count | Sentry + process hooks |

### 2.2 Database (PostgreSQL + PgBouncer) — highest risk
| Parameter | Signal | Source |
|---|---|---|
| **Connection pool saturation** | active vs. max connections | `pg_stat_activity` query |
| Query latency / slow queries | ms, count over threshold | Prisma `$on('query')` / `pg_stat_statements` |
| Query timeouts | count hitting `DB_QUERY_TIMEOUT_MS` (30s) | Prisma error capture |
| Deadlocks / rollbacks | count | `pg_stat_database` |
| Disk usage / DB size | bytes | `pg_database_size()` |
| Replication lag (if applicable) | seconds | provider metric |

### 2.3 Background cron jobs (no failure alerting today — biggest blind spot)
Jobs run via in-memory `@nestjs/schedule` (no BullMQ), so a throw vanishes silently.
| Parameter | Signal | Source |
|---|---|---|
| Last successful run timestamp | per job | new `JobRun` table |
| Execution duration | ms per job | job-tracking wrapper |
| Failure count / last error | per job | job-tracking wrapper |
| Missed/overdue run | now − last_success > schedule | health check derivation |

Tracked jobs: billing retry (`0 8 * * *`), dunning (`0 9 * * *`), notification
digests (daily/weekly/monthly), notification purge (`0 3 * * *`), CRM SMS
campaigns (`*/5 * * * *`), CRM reorder/birthday tasks, customer-segment recalc.

### 2.4 External dependencies (none in health check today)
| Dependency | Parameter | Source |
|---|---|---|
| bKash / Nagad / SSLCommerz | reachability, latency, webhook failure rate | provider ping + `BillingEvent` |
| BulkSMSBD | reachability + **remaining SMS credit balance** | provider API + `SmsTransaction` |
| Resend (email) | reachability, send error rate | provider |
| Cloudinary | reachability | provider |
| Supabase (auth/storage) | reachability | provider |
| Upstash Redis | reachability (fails open today) | `RedisService` ping |

### 2.5 Business / tenant health (SaaS-specific)
| Parameter | Signal | Source |
|---|---|---|
| Failed-login rate / lockouts | count of `login-fail` | `AuditLog` |
| Subscriptions going `PAST_DUE` / auto-cancelled | count | `TenantSubscription`, dunning audit |
| Payment success vs. failure ratio per provider | ratio | `BillingEvent` |
| Per-tenant request anomalies | top-N noisy tenants | metrics interceptor (tenant tag) |

### 2.6 Infrastructure (Render.com)
CPU/memory/restarts, deploy success/failure, SSL cert expiry, external uptime
ping — see `docs/ops/uptime-monitoring.md`. Mostly covered by Render +
external pinger; we surface the cert-expiry and uptime status in the dashboard.

---

## 3. Architecture overview

New backend module: **`apps/backend/src/system-health/`** (kebab-case, per
`CLAUDE.md` conventions). It owns deep checks, the metrics registry, and the
platform-admin health API. The existing `health/` module stays as the
lightweight liveness probe Render hits.

```
apps/backend/src/system-health/
  system-health.module.ts
  system-health.controller.ts        # platform-admin endpoints (guarded)
  system-health.service.ts           # aggregates all checks
  checks/
    database.check.ts                # pool, latency, size
    redis.check.ts                   # Upstash ping
    external.check.ts                # payment / SMS / email / storage
    cron.check.ts                    # reads JobRun table
  metrics/
    metrics.service.ts               # in-process registry (prom-client)
    metrics.interceptor.ts           # latency/throughput/errors per route
    metrics.controller.ts            # GET /metrics (token-guarded)
    runtime.collector.ts             # event-loop lag, memory, uptime
  jobs/
    job-tracker.service.ts           # wrap(jobName, fn) -> records JobRun
    job-tracker.decorator.ts         # @TrackedCron wrapper (optional sugar)
```

Frontend: new platform-admin page at
**`apps/frontend/src/app/dashboard/admin/system-health/page.tsx`**, alongside
the existing `admin/tenants` and `admin/platform-settings` pages.

---

## 4. Phased delivery

Each phase is independently shippable and leaves the system in a working state.

### Phase 0 — Foundations & scaffolding
**Outcome:** module skeleton + readiness endpoint shape agreed, no behavior change risk.
- Create `system-health` module, wire into `AppModule`.
- Define the response contract (TypeScript types in
  `packages/shared-types/index.ts`): `SystemHealthReport`, `DependencyStatus`
  (`'ok' | 'degraded' | 'down' | 'unknown'`), `CheckResult`.
- Add `SYSTEM_HEALTH` permission and gate endpoints behind
  `JwtAuthGuard + PlatformAdminGuard` (reuse existing guard).
- **Acceptance:** `GET /api/v1/admin/system-health` returns 200 for platform
  admin, 403 otherwise, with a static stub payload.
- **Est:** 0.5 day.

### Phase 1 — Deep health / readiness checks
**Outcome:** real dependency status for DB, Redis, and core externals.
- `database.check.ts`: pool saturation via
  `SELECT count(*), (SELECT setting::int FROM pg_settings WHERE name='max_connections') FROM pg_stat_activity`,
  plus `SELECT 1` latency and `pg_database_size(current_database())`.
- `redis.check.ts`: add `ping()` to `RedisService`; report `disabled` when
  credentials absent (don't flag as `down`).
- `external.check.ts`: lightweight reachability + latency for SSLCommerz,
  bKash, Nagad, BulkSMSBD, Resend, Cloudinary, Supabase. Use short timeouts
  (2s) and run in parallel (`Promise.allSettled`).
- Aggregate into `SystemHealthReport` with overall `status` =
  worst-of(dependencies), where a `disabled` optional dep never degrades overall.
- Keep existing `GET /api/v1/health` unchanged (Render liveness).
- **Acceptance:** endpoint reflects real status; killing Redis/DB flips the
  relevant dependency and the overall status; unit tests for the worst-of rollup.
- **Est:** 1.5 days.

### Phase 2 — Cron job observability
**Outcome:** every scheduled job records its outcome; overdue jobs surface as degraded.
- Prisma: add `JobRun` model (see §5). Migration via `packages/database`.
- `job-tracker.service.ts`: `track(jobName, fn)` records start, duration,
  success/failure, error message; updates a `last_success_at` per job.
- Refactor existing cron methods (billing scheduler, notifications, CRM
  campaigns/tasks, segments) to call through the tracker. Minimal change:
  wrap the body, preserve existing logging.
- `cron.check.ts`: compare `now − last_success_at` against each job's expected
  cadence; mark `overdue` jobs as degraded in the report.
- **Acceptance:** a deliberately-throwing job records a `FAILED` `JobRun`;
  dashboard/report shows last run + status per job; overdue detection works.
- **Est:** 2 days.

### Phase 3 — Runtime metrics endpoint
**Outcome:** scrapeable metrics for latency, throughput, errors, runtime, jobs.
- Add `prom-client`. `metrics.service.ts` owns a registry.
- `metrics.interceptor.ts` (global): per-route request count, duration
  histogram, status-class counter, optional `tenantId` label (low cardinality —
  bucket or omit in high-tenant environments).
- `runtime.collector.ts`: event-loop lag (`monitorEventLoopDelay`), memory,
  uptime, GC stats.
- `GET /metrics` (Prometheus text format) guarded by a `METRICS_TOKEN` bearer
  (separate from user auth so a scraper can hit it).
- Export job metrics (last duration, failure total) from Phase 2 data.
- **Note:** this exposes metrics; wiring a scraper (Grafana Cloud, Render
  metrics, or a hosted Prometheus) is an ops follow-up, not in this PR.
- **Acceptance:** `/metrics` returns valid Prometheus exposition; histograms
  populate under load; token required.
- **Est:** 1.5 days.

### Phase 4 — Alerting & thresholds
**Outcome:** humans get paged before users complain.
- Sentry: add alert rules (error-rate spike, payment errors `domain:payment`,
  DB-connection errors). Document rule config in this plan's runbook section.
- Threshold-based alerts driven off the health report (e.g. a tiny internal
  cron that, when overall status is `down`/`degraded` for N minutes, emails
  platform admins via existing `EmailService`, optionally SMS via `SmsService`).
- Config via env: `HEALTH_ALERT_EMAILS`, `HEALTH_ALERT_COOLDOWN_MIN`.
- Surface SMS-credit-low and payment-webhook-failure spikes as first-class alerts.
- **Acceptance:** forcing a degraded state triggers exactly one alert within
  the window (respecting cooldown); recovery is logged.
- **Est:** 1.5 days.

### Phase 5 — Platform-admin dashboard UI
**Outcome:** a single page a platform admin opens to see system health.
- `apps/frontend/src/app/dashboard/admin/system-health/page.tsx`: cards for
  overall status, each dependency, DB pool gauge, cron-job table (last run +
  status), runtime (memory/uptime/event-loop), recent failed logins, SMS
  credit, payment success ratio.
- Poll `GET /api/v1/admin/system-health` every 15–30s; color-coded badges.
- Link from the existing admin nav (next to Tenants / Platform Settings).
- Optionally expose a trimmed public view via the existing `/status` page.
- **Acceptance:** page renders live data; degraded states are visually obvious;
  access restricted to platform admins.
- **Est:** 2 days.

### Phase 6 — Resilience hardening (optional, follow-up)
**Outcome:** a slow provider can't cascade into pool exhaustion.
- Circuit breakers + timeouts around payment (bKash/Nagad/SSLCommerz), SMS,
  email calls (`opossum` or a small custom breaker).
- Expose breaker state in the health report.
- **Est:** 2 days. *Can be deferred; tracked separately.*

---

## 5. Data model changes

New Prisma model (in `packages/database/prisma/schema.prisma`; migration via
`npm run db:migrate`). `JobRun` is **platform-scoped, not tenant-scoped** —
exempt it from `TenantInterceptor` requirements.

```prisma
model JobRun {
  id           String    @id @default(cuid())
  job_name     String
  status       String    // 'RUNNING' | 'SUCCESS' | 'FAILED'
  started_at   DateTime  @default(now())
  finished_at  DateTime?
  duration_ms  Int?
  error        String?
  metadata     Json?
  created_at   DateTime  @default(now())

  @@index([job_name, started_at])
  @@map("job_runs")
}
```
Retain a rolling window (e.g. purge `JobRun` older than 30 days in the existing
`0 3 * * *` notification-purge job to avoid unbounded growth).

---

## 6. API surface (new)

All under `/api/v1`, guarded by `JwtAuthGuard + PlatformAdminGuard` unless noted.

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system-health` | Full aggregated report (dashboard source) |
| GET | `/admin/system-health/jobs` | Cron job run history |
| GET | `/admin/system-health/dependencies` | Dependency statuses only |
| GET | `/metrics` | Prometheus metrics (guarded by `METRICS_TOKEN`, not user auth) |
| GET | `/health` | **Unchanged** — Render liveness probe |

---

## 7. Configuration (new env vars)

Add to `.env.example` and `.env.production.example`, and document in `render.yaml`.

| Var | Default | Purpose |
|---|---|---|
| `METRICS_TOKEN` | — (required to expose `/metrics`) | Bearer token for scraping |
| `HEALTH_ALERT_EMAILS` | — | Comma-separated platform-admin alert recipients |
| `HEALTH_ALERT_COOLDOWN_MIN` | `30` | Min minutes between repeat alerts |
| `HEALTH_DEP_TIMEOUT_MS` | `2000` | Per-dependency probe timeout |
| `SMS_CREDIT_LOW_THRESHOLD` | `100` | Alert when BulkSMSBD credit drops below |

Existing reused: `DB_QUERY_TIMEOUT_MS`, `SENTRY_DSN`, `UPSTASH_REDIS_*`.

---

## 8. Testing strategy
- **Unit:** status roll-up logic (worst-of, `disabled` handling), job tracker
  records success/failure, overdue detection math, threshold/cooldown logic.
- **Integration:** health endpoint with DB up/down (testcontainers or mocked
  Prisma), guard enforcement (403 for non-admin), `/metrics` token check.
- **Manual/QA:** kill Redis, force a cron throw, exhaust a fake SMS quota —
  confirm dashboard + alert behavior.
- Follow existing spec conventions (`*.service.spec.ts`, see
  `admin-tenants.service.spec.ts`).

---

## 9. Rollout & risk
- Each phase is additive and behind the platform-admin guard; no tenant-facing
  behavior changes until Phase 5 (and that's admin-only).
- Dependency probes use short timeouts + `Promise.allSettled` so a slow
  provider never blocks the health endpoint.
- Metrics interceptor must keep label cardinality low (avoid raw `tenantId` as
  a label in large deployments) to prevent metric explosion.
- Migration for `JobRun` is non-breaking (new table, additive).

---

## 10. Effort summary

| Phase | Scope | Est. |
|---|---|---|
| 0 | Scaffolding + types + guard | 0.5d |
| 1 | Deep health checks | 1.5d |
| 2 | Cron observability + `JobRun` | 2d |
| 3 | Metrics endpoint | 1.5d |
| 4 | Alerting | 1.5d |
| 5 | Admin dashboard UI | 2d |
| 6 | Circuit breakers (optional) | 2d |
| | **Core (0–5)** | **~9 days** |

---

## 11. Definition of done (core)
- Platform admin can open **Dashboard → Admin → System Health** and see live
  status for API runtime, DB (incl. pool), Redis, every external provider, and
  every cron job.
- A failing dependency or overdue/failed cron job is visible within one poll
  cycle and triggers an alert (respecting cooldown).
- `/metrics` is scrapeable with a token; `/health` still serves Render liveness.
- New code covered by unit + integration tests; `TODO.md` updated.
