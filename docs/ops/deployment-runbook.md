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
2. **Reverse proxy.** The shared Hermes Caddyfile (`/opt/hermes/caddy/Caddyfile`)
   needs an `erp71.com, www.erp71.com` block on the same upstream as the app
   host. Back it up, edit, `caddy validate`, `caddy reload`:

   ```
   erp71.com, www.erp71.com {
   	encode zstd gzip
   	reverse_proxy erp71-frontend-1:3000
   }
   ```

   **Check for an existing `erp71.com` block first.** Before the cutover the file
   held a single-domain leftover — `erp71.com { redir https://app.erp71.com{uri} }`
   — which points the apex at the app, the opposite of what this needs. It must be
   *replaced*, not appended to: two blocks with the same site address fail
   `caddy validate`.

   Note both hosts are proxied and neither is redirected here. `www` folds into
   the apex in `resolveHostRoute`, so a redirect at the proxy would pre-empt a
   rule the app already owns and tests.

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
- [ ] PR `dev` → `main` reviewed, approved, and **merged** — the merge itself deploys, once CI passes on `main`
- [ ] Database migrations reviewed (if any schema changes)
- [ ] Schema changes are **additive**: nothing the previous release still reads is
      dropped or renamed. The deploy prepares the database while the previous
      backend is still serving, so for a few seconds the old code runs against the
      new schema (see [Database prepare](#database-prepare-and-the-marker-volume))
- [ ] Rollback plan identified (previous good commit hash)

---

## Standard Deploy (main branch)

**Merging to `main` deploys automatically.** `.github/workflows/deploy-vps.yml`
waits for the **CI/CD Pipeline** to pass on that push, then SSHes to the VPS, runs
the idempotent deploy script, and curls both health endpoints. Watch it under
GitHub → Actions → "Deploy to VPS"; a red job means the build failed or the stack
came up unhealthy. Deploys are serialized (`concurrency: deploy-vps`), so two
merges in a row queue rather than build over each other.

It does **not** roll back on failure — see [Rollback Procedure](#rollback-procedure).

To deploy by hand (a redeploy, a rollback, or a non-`main` branch), either use
GitHub → Actions → "Deploy to VPS" → **Run workflow**, or SSH in directly:

```bash
ssh root@66.116.236.127 'cd /opt/erp71 && ./scripts/deploy.sh main'
```

`scripts/deploy.sh` (safe to re-run). `docker compose ...` below is short for
`docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml`.

1. `git fetch` + `git checkout main` + `git pull --ff-only origin main`
2. Syncs erp71.com URLs into `.env.production` (`scripts/sync-erp71-env-urls.sh`)
3. **Builds** the new images: `docker compose ... build`. The old containers keep serving.
4. Makes sure Postgres is up: `docker compose ... up -d --wait db` (a no-op on every deploy but the first)
5. **Prepares the database** for the new commit in a one-off container, while the
   old backend keeps serving:
   `docker compose ... run --rm --no-deps -T backend sh apps/backend/scripts/db-prepare.sh`.
   That is the schema sync (`prisma db push`), the platform catalog and every
   `sync:*` back-fill — see [Database prepare](#database-prepare-and-the-marker-volume).
   **If it fails, the deploy stops here** with nothing swapped and exits non-zero.
6. **Swaps** the containers: `docker compose ... up -d`. The new backend finds the
   marker step 5 left and goes straight to listening.
7. Waits for the backend container to report `healthy` (the compose healthcheck
   on `/api/v1/health`), up to 6 minutes. If it does not, prints the backend's
   last log lines and exits non-zero.
8. Reattaches the shared **Hermes** Caddy to the `erp71_default` network (otherwise `app.erp71.com` returns 502)
9. Trims Docker's build cache to 8 GB (`docker builder prune`); images and containers are not touched
10. Prints `docker compose ... ps`

The whole run takes ~3–5 minutes, nearly all of it steps 3 and 5, while the old
version is still serving. The API is down only between the old backend stopping
and the new one listening in step 6 — Nest's own boot, expected to be a few
seconds (not yet measured on the VPS; time it with a `curl` loop on
`/api/v1/health` during the first deploy after this change). (Before
steps 4–5 existed, the prepare ran inside the new container's start, after the
old one was gone: 19–24 s of 502s per deploy, measured on #766.)

Then run the [Post-Deploy Verification](#post-deploy-verification).

---

## Database prepare and the marker volume

Before the API can serve a new commit, the database has to match it: the
schema sync, the platform catalog and the `sync:*` back-fills, in an order that
matters. All of that is `apps/backend/scripts/db-prepare.sh`; its comments
explain each step. Two things run it:

- **`deploy.sh`**, in a one-off container, before swapping containers (step 5 above).
- **The backend's own start command**, as `db-prepare.sh --if-needed`, which skips
  the work when this commit has already prepared this database.

How a start knows: each successful prepare writes a marker,
`/var/lib/erp71/state/db-prepared-<commit>`, on the **`erp71_backend_state`**
volume, and removes every other commit's marker. A start skips the prepare only
when the marker for its own `GIT_SHA` is there and was written against the same
`DATABASE_URL`. So:

| Situation | What the backend does at start |
|---|---|
| After `deploy.sh` | Skips; just boots |
| Restart of the same commit (crash, host reboot) | Skips |
| Another commit (rollback, a hand-run `up -d --build`) | Prepares first, then boots — correct, but the old ~20 s start |
| Image built without `GIT_SHA` (`unknown`) | Always prepares; never trusts or writes a marker |
| Marker volume lost or emptied | Prepares once, writes a new marker |

```bash
ssh root@66.116.236.127
cd /opt/erp71
C="docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml"

# Which commit last prepared the database, and when
$C run --rm --no-deps -T backend sh -c 'cat /var/lib/erp71/state/db-prepared-*'

# Prepare by hand (always runs; refreshes the marker)
$C run --rm --no-deps -T backend sh apps/backend/scripts/db-prepare.sh
```

**Prepare by hand whenever the database changed behind the marker's back** — the
marker cannot see it:

- after **restoring a backup** (`docs/ops/vps-backups.md`) — the restored schema
  may be older than the running code, and a restart would skip the push;
- after **editing the schema or the back-filled data by hand**.

Then `$C restart backend`.

### If the prepare fails during a deploy

The deploy log shows `db-prepare: FAILED <step> (exit N, after Ns)` and then
`DEPLOY ABORTED`; the workflow goes red. **Production is still on the old
version**: nothing was swapped. Steps before the failing one did run, so if the
failure came after `prisma db push` the schema already has the new commit's
shape — harmless, since schema changes are additive (see the checklist above).
No marker was written for the new commit, and the old commit's marker is left
alone, so the old backend restarts cleanly if it has to.

1. Read the output above the `FAILED` line: it is that step's own error.
2. Fix the cause — usually a commit that fixes the `sync:*` script or the data
   it chokes on, shipped the usual way; for a data problem, a fix by hand after a
   backup.
3. Re-run the deploy. To try the prepare on its own first, run it by hand as
   above — `deploy.sh` has already built the new image, so it runs the new code.

Do **not** start the new containers with a plain `up -d` while the prepare
fails: the new backend would run the same failing prepare at start and never
listen, which turns a failed deploy into an outage.

### If the new backend does not come up healthy

`deploy.sh` prints the backend's last log lines and exits non-zero. Here the old
backend is already gone, so this is an outage: fix forward or roll back
([Rollback Procedure](#rollback-procedure)).

---

## Schema Migrations

This project uses Prisma `db push` (no migration files). Schema changes are applied
on the VPS against the compose Postgres. To run a push explicitly (deploy.sh
already runs one as part of the [database prepare](#database-prepare-and-the-marker-volume),
before swapping containers):

```bash
ssh root@66.116.236.127
cd /opt/erp71
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml run --rm backend sh -lc \
  'npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate'
```

> **Important:** Run migrations during low-traffic windows. Back up first
> (`docs/ops/vps-backups.md`).

## One-off Data Backfills

Scripts in `packages/database/prisma/backfill-*.ts` fix existing data once. Unlike
the `sync:*` steps, they do **not** run on container start. Each one reports by
default and writes only with `--apply`. Run them inside the running backend
container, which already has the database URL and the workspace:

```bash
ssh root@66.116.236.127
cd /opt/erp71
# 1. Report — read what it would change
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml exec backend \
  npm run backfill:task-remaining --workspace=@erp71/database
# 2. Back up (docs/ops/vps-backups.md), then write
docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml exec backend \
  npm run backfill:task-remaining --workspace=@erp71/database -- --apply
```

Add `--tenant=<id>` to either command to limit it to one workspace. The script must
already be deployed (it ships in the backend image), so merge and deploy first.

| Script | What it fixes |
|--------|---------------|
| `backfill:task-remaining` | Open tasks with an estimate, no remaining hours and no time logged get remaining = estimate, with a remaining-hours log row. Done tasks, tasks with time logged, and tasks with no estimate are counted and left alone. |
| `backfill:sprint-history` | Run once after the release that added `sprint_tasks` / `sprint_burndown_points`. Rebuilds each sprint's task history (open rows for planned/active sprints; closed `DONE` / `RETURNED_TO_BACKLOG` rows for completed ones, so a completed sprint lists its carried work again) and its burndown points from the remaining-hours log and the old daily snapshots. Writes only points older than a sprint's first live point, and skips rows already present, so it is safe to re-run. `sprint_snapshots` stays until a later migration drops it. |

---

## Rollback Procedure

### Option 1 — Git revert + redeploy (standard)
```bash
git revert <bad-commit-hash>
git push origin main         # via a dev→main PR per branch policy
ssh root@66.116.236.127 'cd /opt/erp71 && ./scripts/deploy.sh main'
```

### Option 2 — Pin to a known-good commit on the VPS
`deploy.sh` follows a branch, so pinning a commit is the same sequence by hand:
```bash
ssh root@66.116.236.127
cd /opt/erp71
git checkout <good-commit-hash>
export GIT_SHA="$(git rev-parse HEAD)"   # /health reports it; the prepare marker is keyed on it
C="docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml"
$C build
$C run --rm --no-deps -T backend sh apps/backend/scripts/db-prepare.sh   # while the bad version still serves
$C up -d
```
Skipping the `run` line is still correct — the good commit has no marker, so its
backend prepares itself at start — but brings back the ~20 s outage. Either way
the good commit's `db push --accept-data-loss` **drops any column or table the
bad commit added**, and whatever was written to them since. Back up first if that
matters.

(Return to `main` with `./scripts/deploy.sh main` once fixed.)

### Option 3 — Database rollback
If a migration caused data issues, restore from backup — see `docs/ops/vps-backups.md`.
Then prepare by hand ([Database prepare](#database-prepare-and-the-marker-volume)):
the backend's marker cannot tell the database was replaced.

---

## Emergency Contacts / Escalation

| Role | Action |
|---|---|
| Frontend 502 | Confirm Hermes Caddy is attached to `erp71_default` (`docker network connect erp71_default hermes-caddy-1`); check `docker compose ... ps` |
| Backend down | `docker compose -p erp71 ... logs --tail=100 backend`; check `/api/v1/health`; `docker compose ... ps` shows the backend `(healthy)`, `(health: starting)` or `(unhealthy)`. A backend stuck in `starting` is usually preparing the database itself — its log shows `db-prepare:` lines |
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
