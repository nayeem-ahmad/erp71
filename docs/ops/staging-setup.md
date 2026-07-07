# Staging Environment Setup

> **RETIRED — staging on Render.com is no longer used.** The Render staging services (`erp71-backend-staging` / `erp71-frontend-staging`) defined in `render.yaml` were retired when the platform moved off Render.com on 2026-06-27. `render.yaml` is legacy and no longer drives any deploys.
>
> **A dedicated staging environment has not been re-provisioned on the VPS.** The notes below are retained as a reference for what a staging setup needs (separate DB, separate secrets, sandbox payment credentials) if/when one is stood up. Production deploys are documented in `docs/ops/deployment-runbook.md` (SSH + `scripts/deploy.sh main`). Do not point `scripts/deploy.sh` at a `staging` branch on the production VPS — it shares the single production `.env.production` and would clobber production URLs.

## Bootstrap

```bash
git checkout main
git pull origin main
git checkout -b staging
git push -u origin staging
```

## Configure staging secrets (VPS `.env`)

If a staging environment is provisioned, its secrets belong in a separate staging env file (a staging equivalent of `.env.production`) on whatever host runs it — never in any Render dashboard, and never sharing production credentials. Set separate values for each variable below.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Separate Postgres database (Supabase staging project or dedicated DB) |
| `DIRECT_URL` | Direct connection URL for Prisma CLI |
| `JWT_SECRET` | Unique to staging |
| `FRONTEND_URL` | Staging frontend URL |
| `BACKEND_PUBLIC_URL` | Staging backend URL |
| `NEXT_PUBLIC_API_URL` | Staging API base |
| `BILLING_PROVIDER` | `SSL_WIRELESS` with sandbox credentials |
| `SENTRY_DSN` | Optional separate Sentry project |

## Verify staging

```bash
curl https://<staging-backend>/api/v1/health
curl -I https://<staging-frontend>/
```

## Payment webhook testing

Point sandbox IPN/callback URLs at the staging backend:

- `POST/GET /api/v1/billing/webhooks/ssl-wireless`
- `POST /api/v1/billing/webhooks/manual` with `x-billing-webhook-secret`

Run automated webhook tests locally:

```bash
npm run test --workspace=@erp71/backend -- billing.service.spec.ts
```