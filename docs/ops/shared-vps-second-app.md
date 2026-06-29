# Deploying A Second App On The Same VPS

This document is for the developer deploying another application onto the same VPS that already runs ERP71.

The goal is:

- reuse the existing VPS
- reuse the existing PostgreSQL server
- keep the new app isolated with its own database and database user
- avoid port conflicts with the existing Caddy instance

## Current server shape

The VPS already has these pieces running:

- one PostgreSQL container inside the ERP71 stack
- one Caddy instance already bound to ports `80` and `443`
- one Docker network named `erp71_default`

Because of that, the new app must follow these rules:

- do not start a second PostgreSQL container
- do not expose another service on `80` or `443`
- do not run a second public reverse proxy
- do create a separate database and database user for the new app
- do join the existing Docker network so the shared Caddy and shared Postgres can reach the new app

## Directory layout on the VPS

Use a dedicated directory for the new project:

```bash
cd /opt
git clone <new-project-repo-url> new-app
cd /opt/new-app
```

Do not place the new app inside `/opt/erp71`.

## 1. Create a dedicated database and database user

Connect to the existing Postgres container and create a separate role and database.

Replace `new_app_db`, `new_app_user`, and the password before running this.

```bash
docker exec -it erp71-db-1 psql -U postgres -d postgres
```

Then run:

```sql
CREATE ROLE new_app_user WITH LOGIN PASSWORD 'change-this-password';
CREATE DATABASE new_app_db OWNER new_app_user;
GRANT ALL PRIVILEGES ON DATABASE new_app_db TO new_app_user;
```

Important:

- never reuse the ERP71 application database
- never point the new app to `erp71`
- keep schema ownership with the new app user only

If the password contains special URL characters such as `+`, `@`, `:`, `/`, or `%`, URL-encode it in `DATABASE_URL`.

Example:

```text
raw password: my+p@ss
url encoded: my%2Bp%40ss
```

## 2. Join the existing Docker network

The new app must join the existing Docker network so it can reach:

- the shared Postgres container
- the shared Caddy container, if Caddy will proxy to it

In the new app's production compose file, declare the existing network as external:

```yaml
networks:
  shared_vps:
    external: true
    name: erp71_default
```

Then attach the app service to that network.

## 3. Production compose pattern for the new app

Use a compose file that only runs the new app's own services.

Do not add:

- a `db` service
- a `caddy` service that binds `80:80` or `443:443`

Example `docker-compose.prod.yml` for the new app:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-}
    env_file:
      - .env.production
    environment:
      NODE_ENV: production
      PORT: 3000
    restart: unless-stopped
    expose:
      - "3000"
    networks:
      - shared_vps

networks:
  shared_vps:
    external: true
    name: erp71_default
```

Notes:

- `expose` is correct here; do not publish a public port unless there is a very specific reason
- if the app is an API and not a frontend, use the internal port it actually listens on
- if the app needs workers, Redis, or background jobs, those can be separate services in the same compose file

## 4. Use an explicit production env file

Create a `.env.production` for the new app.

Minimum example:

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://new_app_user:change-this-password@erp71-db-1:5432/new_app_db
DIRECT_URL=postgresql://new_app_user:change-this-password@erp71-db-1:5432/new_app_db

APP_PUBLIC_URL=https://newapp.example.com
NEXT_PUBLIC_API_URL=https://api.newapp.example.com
```

Important:

- the host should be `erp71-db-1` on this VPS, because that is the live Postgres container on the shared Docker network
- if the app is a Next.js app, any `NEXT_PUBLIC_*` variables needed by the browser must be available at image build time, not only at container runtime
- always run compose with `--env-file .env.production`

Example:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## 5. Database migrations

Run migrations only against the new app database.

Examples:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app <migration-command>
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app <seed-command>
```

Do not run any migration command against the ERP71 schema or database.

## 6. Reuse the existing Caddy instance

The VPS already has a live Caddy in `/opt/erp71/Caddyfile`.

To publish the new app publicly:

1. deploy the new app container first
2. add a new site block to `/opt/erp71/Caddyfile`
3. reload the ERP71 Caddy container

Example site block for a frontend app:

```caddy
newapp.example.com {
    encode zstd gzip
    reverse_proxy app:3000
}
```

Example site block for an API service:

```caddy
api.newapp.example.com {
    encode zstd gzip
    reverse_proxy app:4000
}
```

This works only if the new app service is attached to `erp71_default`.

After updating the Caddyfile:

```bash
cd /opt/erp71
docker compose --env-file .env.production -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

If reload fails, use:

```bash
cd /opt/erp71
docker compose --env-file .env.production -f docker-compose.prod.yml up -d caddy
```

## 7. DNS records

Create `A` records for the new app's public hostnames and point them to the same VPS IP.

Examples:

- `newapp.example.com`
- `api.newapp.example.com`

TLS will not issue until DNS points to the VPS.

## 8. Verification checklist

From the VPS:

```bash
docker compose --env-file .env.production -f /opt/new-app/docker-compose.prod.yml ps
docker logs --tail 100 <new-app-container-name>
curl -I https://newapp.example.com
curl -I https://api.newapp.example.com
```

Database verification:

```bash
docker exec -it erp71-db-1 psql -U postgres -d postgres -c "\l"
docker exec -it erp71-db-1 psql -U postgres -d new_app_db -c "\dt"
```

## 9. Non-negotiable operational rules

- one app, one database
- one app, one database user
- do not share database schemas across apps
- do not expose Postgres on a public port
- do not start another service on `80` or `443`
- always use `docker compose --env-file .env.production ...` in production
- if the app uses browser-exposed env vars, pass them into the image build, not just runtime env

## 10. Handoff summary for the developer

Tell the developer to deliver these artifacts:

- a production `docker-compose.prod.yml` without Postgres and without host port `80/443` bindings
- a `.env.production.example`
- a migration command for first deploy
- the exact Caddy host block needed
- the exact internal container port the app listens on
- the exact `DATABASE_URL` format for the app

If they follow the pattern above, the second app can safely share the VPS and the PostgreSQL server without interfering with ERP71.
