# Base stage
FROM --platform=linux/amd64 node:22-bullseye AS base
WORKDIR /app

# Dependency stage
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/database/package.json ./packages/database/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm ci --include=optional --no-audit --ignore-scripts \
 && npm rebuild bcrypt --build-from-source \
 && node -e "require('bcrypt'); console.log('bcrypt native binding OK')"

# Builder stage
FROM deps AS builder
COPY . .
# Rebuild bcrypt after full copy — ensures the linux/amd64 binding is present in runner node_modules.
RUN npm rebuild bcrypt --build-from-source \
 && node -e "require('bcrypt'); console.log('bcrypt native binding OK (builder)')"
# Build the shared package first
RUN npm run build --workspace=@erp71/shared-types
# Generate Prisma client
RUN npm run generate --workspace=@erp71/database
# Build the backend
RUN npm run build --workspace=@erp71/backend

# Runner stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy necessary files for NestJS
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/scripts ./apps/backend/scripts
COPY --from=builder /app/packages/database ./packages/database
# Ship compiled shared-types only — tsx seed must not resolve raw .ts sources
# (export * from './navigation' fails under ESM when index.ts is picked over dist/).
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist

EXPOSE 4000
ENV PORT=4000
ENV HOSTNAME="0.0.0.0"

# Git commit this image was built from, surfaced at runtime (health check + deploy status)
# so the app can report exactly what is live in production.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Sync schema, sync the platform catalog, and bring every tenant's accounting
# defaults up to date before starting the app.
#
# DIRECT_URL is overridden with DATABASE_URL so prisma db push uses the
# internal Render hostname, bypassing the IP allowlist that blocks external
# connections during preDeployCommand.
#
# db:seed:platform — NOT db:seed. This runs on every container start, including
# unattended restarts, so it may only touch platform reference data (subscription
# plans + addon modules), which the app reads at runtime and which must track the
# deployed code. prisma/seed.ts is dev/demo fixtures: it writes business data and
# resets known passwords, and must never run here.
#
# sync:accounting runs on every start, after db:seed so it also covers anything
# the seed just created. It is idempotent and additive-only (see
# prisma/sync-accounting.ts), and it is the ONLY thing that carries new default
# accounts/posting rules to tenants that already exist — the bootstrap itself
# runs only at tenant creation. Without it, adding a rule silently posts nothing
# on every existing tenant. It joins the && chain deliberately: a failure here
# means tenants would post to a stale rule set, which must be loud, not skipped.
CMD ["sh", "-c", "DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate --accept-data-loss --schema=packages/database/prisma/schema.prisma && npm run db:seed:platform --workspace=@erp71/database && npm run sync:accounting --workspace=@erp71/database && node apps/backend/dist/src/main.js"]
