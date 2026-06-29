# Staging Environment Setup

Render staging services are defined in `render.yaml` and deploy automatically from the `staging` branch.

## Bootstrap

```bash
git checkout main
git pull origin main
git checkout -b staging
git push -u origin staging
```

## Configure staging secrets (Render dashboard)

Create separate values for each staging service (`erp71-backend-staging`, `erp71-frontend-staging`):

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