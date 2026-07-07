# Deployment Architecture

This section defines the strategy for deploying the application using **Docker** containers on a **self-managed Ubuntu VPS**.

> **Note:** Production and staging were cut over off Render.com to a self-managed VPS on 2026-06-27. Render services are retired and `render.yaml` is legacy/deprecated.

### Deployment Strategy

We leverage a **Docker-first** strategy. Each application in our `apps/` directory (Frontend and Backend) contains its own `Dockerfile`, orchestrated in production via `docker-compose.prod.yml`.

- **Platform:** Self-managed Ubuntu VPS (host `66.116.236.127`, repo at `/opt/erp71`, deploy branch `main`).
- **Deployment Method:** `docker-compose.prod.yml` runs **Caddy 2.x** (auto-TLS reverse proxy) in front of the Next.js frontend (`:3000`) and the NestJS backend (`:4000`), plus self-hosted **PostgreSQL 15** on a named volume. The backend self-initializes the DB (`prisma db push` + seed) on startup.
- **No Auto-Deploy:** There is no automatic deployment. Deploying means SSHing into the VPS and running `./scripts/deploy.sh main` (idempotent). One-liner: `ssh root@66.116.236.127 'cd /opt/erp71 && ./scripts/deploy.sh main'`.
- **Networking:** Containers share the Compose network; Postgres is the compose `db` service (internal `db:5432`) and is not exposed publicly — only Caddy publishes ports 80/443.

### CI/CD Pipeline

The pipeline is orchestrated via **GitHub Actions** for verification; deployment is a manual step:

1.  **Merge:** Code is merged to the `main` branch.
2.  **Lint & Test:** GitHub Actions runs `npm run lint` and `npm test` across the monorepo.
3.  **Manual Deploy:** After merging to `main`, an operator SSHes into the VPS and runs `./scripts/deploy.sh main`, which pulls the branch, rebuilds images, and restarts the Compose stack.
4.  **Health Check:** Confirm the deploy via `GET /api/v1/health` (served at `api.erp71.com`).

### Environment Management

Environment variables are managed in `/opt/erp71/.env.production` on the VPS (`chmod 600`, never committed).

Live URLs: `app.erp71.com` (frontend), `api.erp71.com` (backend).

| Environment | Hosting | Purpose |
| :--- | :--- | :--- |
| **Development** | `docker-compose` | Local replication of the full production environment. |
| **Staging** | Self-managed VPS (Docker Compose + Caddy) | Pre-production environment for final UAT. |
| **Production** | Self-managed VPS (Docker Compose + Caddy) | Live environment for retail stores. |

For the full step-by-step operational guide, see [`docs/ops/deployment-runbook.md`](../ops/deployment-runbook.md).

### Local Development Flow

Developers can spin up the entire stack (Postgres, NestJS, Next.js) using a single command:
```bash
docker-compose up
```
This ensures that every developer is working against the same versions of the database and runtime as production.
