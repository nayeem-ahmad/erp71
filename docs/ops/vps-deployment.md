# VPS Deployment

This deployment path runs PostgreSQL, the backend, and the frontend on a single Ubuntu VPS.

## Topology

- `nayeemahmad.com` -> optional redirect to `app.nayeemahmad.com`
- `app.nayeemahmad.com` -> Caddy -> frontend container on port `3000`
- `api.nayeemahmad.com` -> Caddy -> backend container on port `4000`
- Postgres runs in the `db` container with a persistent Docker volume

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
git clone https://github.com/nayeem-ahmad/retail-saas.git
cd /opt/retail-saas
cp .env.production.example .env.production
# edit .env.production with real secrets
docker compose -f docker-compose.prod.yml up -d --build db
docker compose -f docker-compose.prod.yml run --rm backend sh -lc 'npx prisma db push --schema=packages/database/prisma/schema.prisma && npx tsx packages/database/prisma/seed.ts'
docker compose -f docker-compose.prod.yml up -d --build
```

## DNS

Create these `A` records and point them to the VPS IP:

- `nayeemahmad.com`
- `app.nayeemahmad.com`
- `api.nayeemahmad.com`

TLS issuance will fail until the subdomains resolve to the VPS.

## Shared host (integrated reverse proxy)

On a host that already runs another reverse proxy owning ports 80/443 (the
production VPS at `66.116.236.127` runs an existing Caddy for
`ai.nayeemahmad.com`), do **not** start this stack's own `caddy` service — it
is gated behind the `standalone-edge` Compose profile and skipped by default.
Instead:

1. Deploy without the edge proxy: `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build` (starts `db`, `backend`, `frontend` only).
2. Ensure the existing proxy shares a Docker network with these containers so it can resolve them by name (`retail-saas-frontend-1`, `retail-saas-backend-1`).
3. Add site blocks to the existing proxy's Caddyfile (back it up first, `caddy validate`, then `caddy reload`):

   ```
   app.nayeemahmad.com {
   	encode zstd gzip
   	reverse_proxy retail-saas-frontend-1:3000
   }
   api.nayeemahmad.com {
   	encode zstd gzip
   	reverse_proxy retail-saas-backend-1:4000
   }
   ```

For a dedicated host, enable this stack's own proxy instead:
`docker compose --profile standalone-edge -f docker-compose.prod.yml up -d`.

## Verification

```bash
curl https://api.nayeemahmad.com/api/v1/health
curl -I https://app.nayeemahmad.com
docker compose -f docker-compose.prod.yml ps
docker volume inspect retail-saas_postgres_data
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```
