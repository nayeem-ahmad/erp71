# VPS Deployment Cutover — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Goal:** Move production hosting from Render to a self-managed Ubuntu VPS, using the deployment machinery already present in the repo.

---

## Context

Production currently runs (suspended for billing) on Render as two web services:
`erp71-backend` and `erp71-frontend`, with the database on Supabase.

The repository already contains a complete VPS deployment path:

- `docker-compose.prod.yml` — Postgres + backend + frontend + Caddy
- `Caddyfile` — TLS termination and routing for `nayeemahmad.com`
- `.env.production.example` — production env var template
- `docs/ops/vps-deployment.md` — bootstrap → deploy → DNS → verify runbook

This effort **executes** that path and fills the gaps; it does not redesign it.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| VPS state | Provisioned, SSH access available |
| Database | Self-hosted Postgres container on the VPS (the `db` service in prod compose) |
| Data migration | None — fresh start (`prisma db push` + seed) |
| Deploy method | Manual SSH via a committed `scripts/deploy.sh`; CD can come later |
| Domain | `nayeemahmad.com` as already configured (`app.` → frontend, `api.` → backend) |

## Architecture

```
                    Internet (443/80)
                          │
              ┌───────────▼───────────┐
              │   Caddy (auto-TLS)     │   app.nayeemahmad.com → frontend:3000
              │   reverse proxy        │   api.nayeemahmad.com → backend:4000
              └───┬───────────────┬────┘   nayeemahmad.com   → redirect to app.
        frontend:3000        backend:4000
         (Next.js)            (NestJS)
                                  │
                            db:5432 (Postgres 15, named volume postgres_data)
```

All four containers run on one VPS via `docker compose -f docker-compose.prod.yml`.
No changes to `docker-compose.prod.yml` or `Caddyfile` are required.

## Work items

### 1. DNS (user)
Add A-records pointing to the VPS IP: `nayeemahmad.com`, `app.nayeemahmad.com`,
`api.nayeemahmad.com`. Caddy cannot issue TLS certificates until these resolve.

### 2. `.env.production` (created on the VPS, never committed)
Populate from secrets captured off Render, adjusted for the new topology:

- `DATABASE_URL` / `DIRECT_URL` → local container: `postgresql://<user>:<pass>@db:5432/erp71`
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` → new strong credentials
- `JWT_SECRET` → generate fresh (none existed on Render)
- `FIELD_ENCRYPTION_KEY` → fresh (clean DB, nothing to decrypt)
- `FRONTEND_URL=https://app.nayeemahmad.com`
- `BACKEND_PUBLIC_URL=https://api.nayeemahmad.com`
- `NEXT_PUBLIC_API_URL=https://api.nayeemahmad.com`
- Carry over verbatim: `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` (required for avatar
  uploads), `SMTP_HOST/PORT/USER/PASS`, `SMS_API_KEY/SMS_SENDER_ID`,
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BILLING_PROVIDER=SSL_WIRELESS`
- `PLATFORM_ADMIN_EMAILS=nayeem.ahmad@gmail.com`
- Payment provider creds (`SSL_WIRELESS_*`, `BKASH_*`, `NAGAD_*`) → placeholders;
  they were not set on Render and are not a cutover blocker.

### 3. `scripts/deploy.sh` (new, committed)
One-command manual deploy on the VPS: `git pull` then
`docker compose -f docker-compose.prod.yml up -d --build`. Idempotent and re-runnable.

### 4. First-boot database init
Per the runbook: bring up `db`, run
`prisma db push --schema=packages/database/prisma/schema.prisma` and the seed,
then bring up all services.

### 5. Firewall
`ufw` allow 22/80/443; enable.

### 6. Verification
- `curl https://api.nayeemahmad.com/api/v1/health` returns healthy
- `https://app.nayeemahmad.com` loads with valid TLS
- Log in as platform admin
- Upload a profile avatar (validates Cloudinary end-to-end)
- `docker compose -f docker-compose.prod.yml ps` all healthy

### 7. Decommission Render
Leave the Render services suspended until the VPS is verified working, then remove them.

## Risks / callouts

- **`NEXT_PUBLIC_API_URL` is a build-time arg** baked into the frontend image; it must be
  set in `.env.production` before the build or the frontend will call the wrong API.
  (Already wired through the compose `build.args`.)
- **Secrets handling:** captured values live only in the session scratchpad and are written
  directly into `.env.production` on the VPS over SSH — never committed to git.
- **Payments unconfigured** today (no Render creds); placeholders only, not a blocker.
- **No automated backups** of the self-hosted Postgres yet — out of scope for this cutover,
  noted as follow-up.

## Out of scope (follow-ups)

- GitHub Actions CD (automated deploy on push)
- Postgres backup/restore automation
- Supabase → VPS data migration (not needed; fresh start)
- Staging environment on the VPS
