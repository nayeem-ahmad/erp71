# VPS Deployment Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up production on a self-managed Ubuntu VPS using the repo's existing `docker-compose.prod.yml` + Caddy stack, with a self-hosted Postgres and a fresh database, then retire the Render services.

**Architecture:** One VPS runs four containers via `docker-compose.prod.yml`: Caddy (auto-TLS reverse proxy) in front of the Next.js frontend (`:3000`) and NestJS backend (`:4000`), with Postgres 15 (`:5432`) on a named volume. Caddy routes `app.nayeemahmad.com` → frontend and `api.nayeemahmad.com` → backend. The backend container self-initializes the DB on startup (`prisma db push` + seed).

**Tech Stack:** Docker + Docker Compose, Caddy 2.9, PostgreSQL 15, NestJS, Next.js 15, Prisma.

## Global Constraints

- **Operator-supplied inputs** (set as shell vars in the local session before SSH steps; these are environment values, not plan placeholders):
  - `VPS_HOST` — VPS IP or hostname
  - `VPS_USER` — SSH user (e.g. `root` or a sudo user)
  - `VPS_IP` — public IPv4 of the VPS (for DNS A-records)
- **Repo path on VPS:** `/opt/erp71`
- **Compose file:** always `-f docker-compose.prod.yml`
- **Deploy branch on VPS:** `main`
- **Secrets source:** captured values in session scratchpad `render-prep-SECRETS.env`. Secrets are written only into `/opt/erp71/.env.production` on the VPS over SSH — never committed to git.
- **Domain:** `nayeemahmad.com`, `app.nayeemahmad.com`, `api.nayeemahmad.com`
- **Do not delete the Render services** until VPS verification (Task 7) passes.

---

### Task 1: Add `scripts/deploy.sh` manual-deploy helper

**Files:**
- Create: `scripts/deploy.sh`

**Interfaces:**
- Produces: an idempotent, re-runnable deploy script invoked on the VPS as `./scripts/deploy.sh [branch]` (default `main`).

- [ ] **Step 1: Write the script**

Create `scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
# Manual deploy helper for the VPS. Pulls the latest code and (re)builds the
# production stack. Idempotent — safe to re-run.
set -euo pipefail

BRANCH="${1:-main}"
COMPOSE_FILE="docker-compose.prod.yml"

# Resolve repo root regardless of where the script is called from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f ".env.production" ]; then
  echo "ERROR: .env.production not found in $REPO_ROOT — create it before deploying." >&2
  exit 1
fi

echo "==> Fetching origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Building and starting the stack"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Current status"
docker compose -f "$COMPOSE_FILE" ps
```

- [ ] **Step 2: Make it executable and syntax-check it**

Run:
```bash
cd /Users/bs01621/Projects/nayeem/erp71
chmod +x scripts/deploy.sh
bash -n scripts/deploy.sh && echo "SYNTAX OK"
```
Expected: prints `SYNTAX OK`, no errors.

- [ ] **Step 3: Lint with shellcheck if available (non-blocking)**

Run:
```bash
command -v shellcheck >/dev/null && shellcheck scripts/deploy.sh || echo "shellcheck not installed — skipping"
```
Expected: either no shellcheck findings, or the skip message.

- [ ] **Step 4: Commit**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add scripts/deploy.sh
git commit -m "chore(deploy): add manual VPS deploy script"
```

---

### Task 2: Create DNS A-records (operator action)

**Files:** none (external DNS provider).

- [ ] **Step 1: Add three A-records** at the DNS provider for `nayeemahmad.com`, each pointing to `$VPS_IP`:
  - `nayeemahmad.com` → `$VPS_IP`
  - `app.nayeemahmad.com` → `$VPS_IP`
  - `api.nayeemahmad.com` → `$VPS_IP`

- [ ] **Step 2: Verify resolution** (allow for propagation)

Run (from the local machine):
```bash
for h in nayeemahmad.com app.nayeemahmad.com api.nayeemahmad.com; do
  echo -n "$h -> "; dig +short "$h" A | tr '\n' ' '; echo
done
```
Expected: each host prints `$VPS_IP`. Do not proceed to Task 6 (TLS) until all three resolve, or Caddy's certificate issuance will fail.

---

### Task 3: Prepare the VPS (Docker, firewall, repo)

**Files:** none (remote host configuration). All commands run **on the VPS** unless noted.

**Interfaces:**
- Produces: a VPS with Docker Engine + compose plugin, ufw allowing 22/80/443, and the repo cloned at `/opt/erp71` on branch `main`.

- [ ] **Step 1: Open an SSH session**

Run (local):
```bash
ssh "$VPS_USER@$VPS_HOST"
```
Expected: a shell on the VPS.

- [ ] **Step 2: Check whether Docker is already installed**

Run (VPS):
```bash
docker --version && docker compose version || echo "DOCKER MISSING"
```
Expected: prints versions, OR `DOCKER MISSING`.

- [ ] **Step 3: Install Docker only if missing**

If Step 2 printed `DOCKER MISSING`, run (VPS):
```bash
apt update
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
```
Then re-run Step 2 to confirm versions print.

- [ ] **Step 4: Configure the firewall**

Run (VPS):
```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```
Expected: `Status: active` and rules for 22, 80, 443.

- [ ] **Step 5: Clone the repository**

Run (VPS):
```bash
mkdir -p /opt
cd /opt
[ -d erp71 ] || git clone https://github.com/nayeem-ahmad/erp71.git
cd /opt/erp71
git checkout main
git pull --ff-only origin main
git rev-parse --abbrev-ref HEAD
```
Expected: prints `main`.

---

### Task 4: Create `.env.production` on the VPS

**Files:**
- Create (on VPS, uncommitted): `/opt/erp71/.env.production`

**Interfaces:**
- Consumes: captured secret values from scratchpad `render-prep-SECRETS.env`.
- Produces: a complete production env file the compose stack reads via `env_file`.

- [ ] **Step 1: Generate fresh secrets** (VPS)

Run:
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "FIELD_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
```
Record these three values for Step 2.

- [ ] **Step 2: Write `/opt/erp71/.env.production`** (VPS)

Create the file with the following content. Replace the three `__GENERATED__` values with Step 1 output, and the `__FROM_SCRATCHPAD__` values with the matching entries from `render-prep-SECRETS.env`. Keep `POSTGRES_PASSWORD` identical in the credential line and in `DATABASE_URL`/`DIRECT_URL`.

```bash
cat > /opt/erp71/.env.production <<'EOF'
NODE_ENV=production

# Public application URLs
FRONTEND_URL=https://app.nayeemahmad.com
BACKEND_PUBLIC_URL=https://api.nayeemahmad.com
NEXT_PUBLIC_API_BASE=
NEXT_PUBLIC_API_URL=https://api.nayeemahmad.com

# VPS Postgres (self-hosted container)
POSTGRES_USER=retail
POSTGRES_PASSWORD=__GENERATED_POSTGRES_PASSWORD__
POSTGRES_DB=erp71
DATABASE_URL=postgresql://retail:__GENERATED_POSTGRES_PASSWORD__@db:5432/erp71
DIRECT_URL=postgresql://retail:__GENERATED_POSTGRES_PASSWORD__@db:5432/erp71

# Supabase (storage/auth values carried over from Render)
NEXT_PUBLIC_SUPABASE_URL=__FROM_SCRATCHPAD__
SUPABASE_SERVICE_ROLE_KEY=__FROM_SCRATCHPAD__

# Auth and admin
JWT_SECRET=__GENERATED_JWT_SECRET__
FIELD_ENCRYPTION_KEY=__GENERATED_FIELD_ENCRYPTION_KEY__
PLATFORM_ADMIN_EMAILS=nayeem.ahmad@gmail.com

# Image uploads (required for profile avatar feature)
CLOUDINARY_CLOUD_NAME=__FROM_SCRATCHPAD__
CLOUDINARY_API_KEY=__FROM_SCRATCHPAD__
CLOUDINARY_API_SECRET=__FROM_SCRATCHPAD__

# Email (Brevo SMTP, carried over from Render)
SMTP_HOST=__FROM_SCRATCHPAD__
SMTP_PORT=__FROM_SCRATCHPAD__
SMTP_USER=__FROM_SCRATCHPAD__
SMTP_PASS=__FROM_SCRATCHPAD__

# SMS (carried over from Render)
SMS_API_KEY=__FROM_SCRATCHPAD__
SMS_SENDER_ID=__FROM_SCRATCHPAD__

# Billing (provider set; payment creds were not configured on Render — placeholders)
BILLING_PROVIDER=SSL_WIRELESS
EOF
chmod 600 /opt/erp71/.env.production
```

- [ ] **Step 3: Verify the file is complete and has no unreplaced placeholders** (VPS)

Run:
```bash
cd /opt/erp71
grep -c '__GENERATED__\|__FROM_SCRATCHPAD__\|__GENERATED_POSTGRES_PASSWORD__\|__GENERATED_JWT_SECRET__\|__GENERATED_FIELD_ENCRYPTION_KEY__' .env.production
```
Expected: prints `0`. If non-zero, finish replacing placeholders before continuing.

- [ ] **Step 4: Confirm required keys are present** (VPS)

Run:
```bash
for k in DATABASE_URL DIRECT_URL JWT_SECRET FIELD_ENCRYPTION_KEY NEXT_PUBLIC_API_URL CLOUDINARY_API_SECRET POSTGRES_PASSWORD; do
  grep -q "^$k=." .env.production && echo "$k OK" || echo "$k MISSING/EMPTY"
done
```
Expected: every line prints `OK`.

---

### Task 5: First deployment (build + start the full stack)

**Files:** none (uses committed compose + the script from Task 1).

**Interfaces:**
- Consumes: `/opt/erp71/.env.production` (Task 4), `scripts/deploy.sh` (Task 1).
- Produces: four running containers; backend self-runs `prisma db push` + seed on startup.

- [ ] **Step 1: Run the deploy script** (VPS)

Run:
```bash
cd /opt/erp71
./scripts/deploy.sh main
```
Expected: images build, then `docker compose ... ps` lists `db`, `backend`, `frontend`, `caddy`.

- [ ] **Step 2: Confirm the backend initialized the database** (VPS)

Run:
```bash
docker compose -f docker-compose.prod.yml logs backend | grep -iE "seed complete|Nest application successfully started"
```
Expected: shows the seed completion and `Nest application successfully started`.

- [ ] **Step 3: Confirm all containers are up** (VPS)

Run:
```bash
docker compose -f docker-compose.prod.yml ps
```
Expected: `db`, `backend`, `frontend`, `caddy` all `Up` (db `healthy`).

- [ ] **Step 4: Confirm Postgres has tables** (VPS)

Run:
```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U retail -d erp71 -c '\dt' | head
```
Expected: a list of tables (User, Tenant, etc.), not "No relations found".

---

### Task 6: End-to-end verification over HTTPS

**Files:** none.

**Interfaces:**
- Consumes: running stack (Task 5), resolving DNS (Task 2).

- [ ] **Step 1: Wait for Caddy to issue certificates** (VPS)

Run:
```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -iE "certificate obtained|serving initial configuration"
```
Expected: log lines showing certificates obtained for `app.` and `api.` hosts. If absent, recheck DNS (Task 2) and wait.

- [ ] **Step 2: Backend health over HTTPS** (local or VPS)

Run:
```bash
curl -fsS https://api.nayeemahmad.com/api/v1/health
```
Expected: a 200 JSON health response.

- [ ] **Step 3: Frontend loads over HTTPS with valid TLS** (local)

Run:
```bash
curl -sS -o /dev/null -w "%{http_code} %{ssl_verify_result}\n" https://app.nayeemahmad.com
```
Expected: `200 0` (HTTP 200, TLS verify result 0 = OK).

- [ ] **Step 4: Manual smoke test** (browser)

In a browser:
1. Open `https://app.nayeemahmad.com` and log in as the platform admin (`nayeem.ahmad@gmail.com`).
2. Open **My Profile**, upload a profile photo, crop, and save.

Expected: login succeeds; avatar upload returns success and the image renders (this validates Cloudinary end-to-end). If upload fails, recheck the `CLOUDINARY_*` values in `.env.production`.

---

### Task 7: Decommission Render

**Files:** none (Render API/dashboard).

**Interfaces:**
- Consumes: confirmation that Task 6 passed.

- [ ] **Step 1: Confirm VPS is serving production** — only proceed if Task 6 Steps 2–4 all passed.

- [ ] **Step 2: Delete the Render web services** via the Render REST API (services `srv-d70494ua2pns73aua5ig` backend, `srv-d7049f7kijhs73d69f70` frontend). This is destructive and final; confirm with the user immediately before running:

```bash
KEY=$(python3 -c "import yaml;print(yaml.safe_load(open('$HOME/.render/cli.yaml'))['api']['key'])")
for SVC in srv-d70494ua2pns73aua5ig srv-d7049f7kijhs73d69f70; do
  curl -s -X DELETE -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services/$SVC" -w "delete $SVC -> %{http_code}\n"
done
```
Expected: each returns `204`.

- [ ] **Step 3: Verify removal**

```bash
render services -o json | python3 -c "import sys,json; [print(e['service']['name']) for e in json.load(sys.stdin) if 'service' in e]"
```
Expected: the two `erp71-*` web services no longer listed.

- [ ] **Step 4: Update TODO.md** per repo convention — mark the VPS cutover done with today's date; commit on `dev`.

---

## Notes for the executor

- The backend image's startup command runs `prisma db push --accept-data-loss` + seed every boot; the seed is idempotent. No separate manual DB-init step is needed.
- `NEXT_PUBLIC_API_URL` is baked into the frontend image at **build** time via compose `build.args`; it must already be in `.env.production` before Task 5 Step 1.
- Re-deploys after this are just `./scripts/deploy.sh main` on the VPS.
- Postgres backups are out of scope here — track as a follow-up.
