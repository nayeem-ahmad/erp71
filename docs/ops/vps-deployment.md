# VPS Deployment

This deployment path runs PostgreSQL, the backend, and the frontend on a single Ubuntu VPS.

## Topology

- `erp71.com`, `www.erp71.com` -> Caddy -> frontend container on port `3000` (marketing site)
- `app.erp71.com` -> Caddy -> frontend container on port `3000` (signed-in app)
- `api.erp71.com` -> Caddy -> backend container on port `4000`
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

## Shared host (integrated reverse proxy)

On a host that already runs another reverse proxy owning ports 80/443 (the
production VPS at `66.116.236.127` runs the shared **Hermes** Caddy), do **not**
start this stack's own `caddy` service — it is gated behind the
`standalone-edge` Compose profile and skipped by default. Instead:

1. Deploy without the edge proxy: `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build` (starts `db`, `backend`, `frontend` only).
2. Ensure the existing proxy shares a Docker network with these containers so it can resolve them by name (`erp71-frontend-1`, `erp71-backend-1`). `scripts/deploy.sh` reattaches it on every deploy.
3. Add site blocks to the existing proxy's Caddyfile (back it up first, `caddy validate`, then `caddy reload`):

   ```
   erp71.com, www.erp71.com {
   	encode zstd gzip
   	reverse_proxy erp71-frontend-1:3000
   }
   app.erp71.com {
   	encode zstd gzip
   	reverse_proxy erp71-frontend-1:3000
   }
   api.erp71.com {
   	encode zstd gzip
   	reverse_proxy erp71-backend-1:4000
   }
   ```

   The marketing pair and the app point at the same upstream on purpose — one
   Next.js container serves both, and it reads `Host` to decide which site a
   request is for. Caddy passes `Host` through unchanged by default, so nothing
   extra is needed; a proxy that rewrites it must send the original in
   `X-Forwarded-Host`.

For a dedicated host, enable this stack's own proxy instead:
`docker compose --profile standalone-edge -f docker-compose.prod.yml up -d`.

## Verification

```bash
curl https://api.erp71.com/api/v1/health
curl -I https://app.erp71.com
curl -I https://erp71.com
docker compose -f docker-compose.prod.yml ps
docker volume inspect erp71_postgres_data
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```
