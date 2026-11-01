# VPS Deployment

This deployment path runs PostgreSQL, the backend, and the frontend on a single Ubuntu VPS.

## Topology

- `erp71.com`, `www.erp71.com` -> Caddy -> frontend container on port `3000` (marketing site)
- `app.erp71.com` -> Caddy -> frontend container on port `3000` (signed-in app),
  except `app.erp71.com/api/v1/*` -> backend container on port `4000` (the
  browser's API calls, kept same-origin to skip the CORS preflight)
- `api.erp71.com` -> Caddy -> backend container on port `4000` (mobile app,
  API-key clients, payment callbacks)
- Postgres runs in the `db` container with a persistent Docker volume

The marketing site and the app are the same Next.js container. `src/middleware.ts`
tells them apart from the `Host` header, so Caddy only has to hand every frontend
host to the same upstream. See the runbook's [Domains](./deployment-runbook.md#domains)
section for what the split does and how to turn it on.

## Files

- `docker-compose.prod.yml` runs Postgres, builds the frontend and backend, and runs Caddy
- `Caddyfile` terminates TLS and routes traffic to the internal containers
- `.env.production.example` lists the required production environment variables and VPS Postgres credentials

## Server bootstrap

```bash
apt update
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
```

## App deployment

```bash
cd /opt
git clone https://github.com/nayeem-ahmad/erp71.git
cd /opt/erp71
cp .env.production.example .env.production
# edit .env.production with real secrets
docker compose -f docker-compose.prod.yml up -d --build db
docker compose -f docker-compose.prod.yml run --rm backend sh -lc 'npx prisma db push --schema=packages/database/prisma/schema.prisma && npx tsx packages/database/prisma/seed.ts'
docker compose -f docker-compose.prod.yml up -d --build
```

## DNS

Create these `A` records and point them to the VPS IP:

- `erp71.com`
- `www.erp71.com`
- `app.erp71.com`
- `api.erp71.com`

TLS issuance will fail until each name resolves to the VPS.

## Public edge (this stack's Caddy)

This VPS *is* the public reverse proxy. Compose service `caddy`
(`erp71-caddy-1`, image `caddy:2.9-alpine`) binds host 80/443. ERP71 and
Meet71 site blocks live in git `Caddyfile`. Neighbor apps (JobXprss, Scrum71,
yt2mp3, profiles) live in `/opt/erp71/Caddyfile.neighbors` (gitignored,
chmod 600). `scripts/deploy.sh` fail-closes if that file is missing, a
directory, or has no site blocks; restore from
`/root/caddy-cutover-*-neighbors.bak`. Extra docker networks are listed in
`/opt/erp71/caddy-extra-networks` and re-attached after every Caddy recreate.

Do not start a second proxy on 80/443. Do not `docker compose down` the whole
`erp71` project — Meet71 and neighbors share `erp71_default`.

To reload after editing the git Caddyfile or neighbors **in place**
(`cat >` / `tee`, never `mv`): run `scripts/deploy.sh`, or the
`sync_caddy_config` wrapper in `shared-vps-second-app.md` (defines `compose()`
before sourcing `scripts/caddy-edge.sh`). A bare `source scripts/caddy-edge.sh`
without `compose()` cannot recreate Caddy after an inode change.

The marketing pair and the app point at the same frontend upstream on purpose
— one Next.js container serves both, and it reads `Host`. Caddy passes `Host`
through unchanged. `/api/v1/*` on the app host goes to the backend because the
browser calls its own origin — see the runbook's
[API on the app domain](./deployment-runbook.md#api-on-the-app-domain).

## Verification

```bash
curl https://api.erp71.com/api/v1/health
curl https://app.erp71.com/api/v1/health
curl -I https://app.erp71.com
curl -I https://erp71.com
docker compose -f docker-compose.prod.yml ps
docker volume inspect erp71_postgres_data
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```
