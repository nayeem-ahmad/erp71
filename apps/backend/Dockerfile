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
RUN npm run build --workspace=@erp71/shared-types || true
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
COPY --from=builder /app/packages/shared-types ./packages/shared-types

EXPOSE 4000
ENV PORT=4000
ENV HOSTNAME="0.0.0.0"

# Sync schema and seed before starting the app.
# DIRECT_URL is overridden with DATABASE_URL so prisma db push uses the
# internal Render hostname, bypassing the IP allowlist that blocks external
# connections during preDeployCommand.
CMD ["sh", "-c", "DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate --accept-data-loss --schema=packages/database/prisma/schema.prisma && npm run db:seed --workspace=@erp71/database && node apps/backend/dist/src/main.js"]
