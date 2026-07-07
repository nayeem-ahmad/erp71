# Production Deployment Runbook

> **Production runs on a self-managed Ubuntu VPS, not Render.** Render.com was
> retired in the 2026-06-27 cutover. `render.yaml` and
> `scripts/render-provision-free-tier.sh` are kept only as legacy references.

**At a glance:**

| | |
|---|---|
| Host | `66.116.236.127` (SSH user `root`) |
| Repo path | `/opt/erp71` |
| Deploy branch | `main` |
| Stack | `docker-compose.prod.yml` — Caddy + Next.js (`:3000`) + NestJS (`:4000`) + Postgres 15 |
| Live URL | `app.erp71.com` (Caddy auto-TLS) |
| Runtime env | `/opt/erp71/.env.production` (chmod 600, uncommitted) |

---

## Pre-Deployment Checklist

- [ ] All CI checks green on the release branch
- [ ] PR `dev` → `main` reviewed, approved, and **merged** (there is no auto-deploy — deploying is a manual SSH step)
- [ ] Database migrations reviewed (if any schema changes)
- [ ] Rollback plan identified (previous good commit hash)

---

## Standard Deploy (main branch)

There is **no auto-deploy**. After merging to `main`, SSH into the VPS and run the
idempotent deploy script:

```bash
ssh root@66.116.236.127 'cd /opt/erp71 && ./scripts/deploy.sh main'
```

`scripts/deploy.sh` (safe to re-run):

1. `git fetch` + `git checkout main` + `git pull --ff-only origin main`
2. Syncs erp71.com URLs into `.env.production` (`scripts/sync-erp71-env-urls.sh`)
3. Rebuilds + restarts the stack:
   `docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml up -d --build`
4. Reattaches the shared **Hermes** Caddy to the `erp71_default` network (otherwise `app.erp71.com` returns 502)
5. Prints `docker compose ... ps`

Build + restart takes ~3–5 minutes. Then run the [Post-Deploy Verification](#post-deploy-verification).

---

## Schema Migrations

This project uses Prisma `db push` (no migration files). Schema changes are applied
on the VPS against the compose Postgres. To run a push explicitly (deploy.sh's
`--build` restart also re-runs the backend's startup `db push`):

```bash
ssh root@66.116.236.127
cd /opt/erp71
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml run --rm backend sh -lc \
  'npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate'
```

> **Important:** Run migrations during low-traffic windows. Back up first
> (`docs/ops/vps-backups.md`).

---

## Rollback Procedure

### Option 1 — Git revert + redeploy (standard)
```bash
git revert <bad-commit-hash>
git push origin main         # via a dev→main PR per branch policy
ssh root@66.116.236.127 'cd /opt/erp71 && ./scripts/deploy.sh main'
```

### Option 2 — Pin to a known-good commit on the VPS
```bash
ssh root@66.116.236.127
cd /opt/erp71
git checkout <good-commit-hash>
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml up -d --build
```
(Return to `main` with `./scripts/deploy.sh main` once fixed.)

### Option 3 — Database rollback
If a migration caused data issues, restore from backup — see `docs/ops/vps-backups.md`.

---

## Emergency Contacts / Escalation

| Role | Action |
|---|---|
| Frontend 502 | Confirm Hermes Caddy is attached to `erp71_default` (`docker network connect erp71_default hermes-caddy-1`); check `docker compose ... ps` |
| Backend down | `docker compose -p erp71 ... logs --tail=100 backend`; check `/api/v1/health` |
| DB issues | Check the `db` container logs + disk on the VPS; restore from backup if needed |
| Payment webhook failing | Check SSL Wireless / bKash / Nagad dashboards |
| Email not sending | Verify SMTP/`EMAIL_FROM` in `.env.production`; check Brevo dashboard logs |

---

## Environment Variables — Production

All secrets live in `/opt/erp71/.env.production` on the VPS (chmod 600, never in git).

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Compose Postgres URL |
| `DIRECT_URL` | Direct Postgres URL — for Prisma CLI |
| `JWT_SECRET` | Long random secret |
| `FIELD_ENCRYPTION_KEY` | 32 bytes as 64-char hex or base64; if unset, derived from `JWT_SECRET` |
| SMTP / `EMAIL_FROM` | Brevo relay credentials |
| Payment credentials | SSL Wireless / bKash / Nagad — production values |

---

## Post-Deploy Verification

```bash
ssh root@66.116.236.127
cd /opt/erp71

# 1. Container status — all Up/healthy
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml ps

# 2. Backend health
curl -s https://api.erp71.com/api/v1/health

# 3. Frontend reachable
curl -s -o /dev/null -w '%{http_code}\n' https://app.erp71.com

# 4. Backend logs — no boot errors
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml logs --tail=50 backend
```

Then smoke-test in the browser: log in, load `app.erp71.com`, exercise the changed
feature.

See also: `docs/ops/vps-backups.md`, `docs/ops/shared-vps-second-app.md`.
