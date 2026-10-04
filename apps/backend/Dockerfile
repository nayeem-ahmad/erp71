# Base stage
FROM --platform=linux/amd64 node:22-bookworm AS base
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

# external-sync-snapshots: see EXTERNAL_SYNC_SNAPSHOT_DIR in docker-compose.prod.yml.
# state: the "prepared for commit X" marker (apps/backend/scripts/db-prepare.sh).
# Both are volume mount points in production; creating them here keeps an
# image run without the volumes working, with the files in the container.
RUN mkdir -p /var/lib/erp71/external-sync-snapshots /var/lib/erp71/state

EXPOSE 4000
ENV PORT=4000
ENV HOSTNAME="0.0.0.0"

# Git commit this image was built from, surfaced at runtime (health check + deploy status)
# so the app can report exactly what is live in production.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Prepare the database for this commit, then start the app.
#
# "Prepare" is the schema sync (prisma db push), the platform catalog and every
# sync:* back-fill — the chain that used to be spelled out here as one long
# `&&` command. It lives in apps/backend/scripts/db-prepare.sh now, with the
# comments explaining each step and why the order is load-bearing: read them
# before adding a step.
#
# --if-needed skips the chain when this commit has already prepared this
# database, which scripts/deploy.sh does in a one-off container while the old
# backend is still serving. The proof is a marker on the backend_state volume
# (/var/lib/erp71/state, docker-compose.prod.yml), so a start after deploy.sh
# is just Nest booting. Without that marker — a plain `docker compose up -d`,
# a rollback to another commit, GIT_SHA=unknown — the container prepares
# itself first, exactly as every start did before. See the script's header.
#
# `exec` hands PID 1 to node rather than leaving a shell waiting on it.
CMD ["sh", "-c", "sh apps/backend/scripts/db-prepare.sh --if-needed && exec node apps/backend/dist/src/main.js"]
