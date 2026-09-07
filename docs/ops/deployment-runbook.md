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
| Live URLs | `erp71.com` / `www.erp71.com` (marketing), `app.erp71.com` (app), `api.erp71.com` (API) — Caddy auto-TLS |
| Runtime env | `/opt/erp71/.env.production` (chmod 600, uncommitted) |

---

## Domains

Four public names. Three of them — `erp71.com`, `www.erp71.com` and
`app.erp71.com` — are the same Next.js container;
`apps/frontend/src/middleware.ts` reads the `Host` header and decides which of
the two sites a request belongs to.

| Host | Serves |
|---|---|
| `erp71.com` | Marketing site — homepage, pricing, blog, legal pages |
| `www.erp71.com` | Same, redirected (308) to the apex so nothing is indexed twice |
| `app.erp71.com` | The signed-in app. `/` is the front door: dashboard, or the account chooser when the identity has more than one workspace, or the login page when the browser holds no session |
| `api.erp71.com` | Backend API |

Two rules follow:

- An **app path typed against the marketing host** (`erp71.com/login`,
  `erp71.com/dashboard`, …) is redirected to `app.erp71.com`. This is not
  cosmetic: the session is an access token in the browser's storage, which is
  scoped to an origin, so signing in on `erp71.com` would leave the credentials
  on a host the app is not served from.
- **`app.erp71.com/` never shows the marketing homepage.** It renders a gate
  that reads the session in the browser (the server cannot — the token is in web
  storage) and continues to `/dashboard` or `/login`. Every other marketing path
  stays reachable on the app host; only the front door changes.

### Turning it on

The behaviour is off until `NEXT_PUBLIC_MARKETING_URL` names the marketing
origin. Until then the frontend behaves as a single-domain deployment, exactly
as it did before the two domains existed. Order matters — the last step is what
makes `app.erp71.com/` stop serving marketing, so do not take it before the
apex can serve it instead:

1. **DNS.** `A` records for `erp71.com` and `www.erp71.com` pointing at
   `66.116.236.127`. Confirm with `dig +short erp71.com`.
2. **Reverse proxy.** Add the site block to the shared Hermes Caddyfile (back it
   up, `caddy validate`, `caddy reload`) — same upstream as the app host:

   ```
   erp71.com, www.erp71.com {
   	encode zstd gzip
   	reverse_proxy erp71-frontend-1:3000
   }
   ```

   Caddy passes `Host` through unchanged, which is what the middleware reads. A
   proxy that rewrites it must send the original in `X-Forwarded-Host`.
   Certificates are issued on the first request, so give it a few seconds.
3. **Env + redeploy.** In `/opt/erp71/.env.production`:

   ```
   NEXT_PUBLIC_MARKETING_URL=https://erp71.com
   NEXT_PUBLIC_APP_URL=https://app.erp71.com
   ```

   Then `./scripts/deploy.sh main`. Both are `NEXT_PUBLIC_*`, so Next inlines
   them at build time — a rebuild is required, which is what the deploy script
   does. `scripts/sync-erp71-env-urls.sh` leaves
   `NEXT_PUBLIC_MARKETING_URL` alone on purpose.

To back it out, blank `NEXT_PUBLIC_MARKETING_URL` and redeploy: the app returns
to serving both sites from `app.erp71.com`, and nothing else changes.

### Verifying

```bash
# Marketing site answers at the apex, and www folds into it
curl -s -o /dev/null -w '%{http_code}\n' https://erp71.com
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.erp71.com

# An app path on the marketing host moves to the app host
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://erp71.com/login

# The app's front door is the gate, not the marketing homepage
curl -s https://app.erp71.com | grep -c 'Run your business'   # expect 0
```

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

# 3. Frontend reachable — app host and marketing host
curl -s -o /dev/null -w '%{http_code}\n' https://app.erp71.com
curl -s -o /dev/null -w '%{http_code}\n' https://erp71.com

# 4. Backend logs — no boot errors
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml logs --tail=50 backend
```

Then smoke-test in the browser: load `erp71.com` (marketing homepage), log in at
`app.erp71.com` (front door lands on the dashboard or the account chooser), and
exercise the changed feature.

See also: `docs/ops/vps-backups.md`, `docs/ops/shared-vps-second-app.md`.
