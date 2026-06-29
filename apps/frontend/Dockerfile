# Base stage
FROM --platform=linux/amd64 node:22-bullseye AS base
WORKDIR /app

# Dependency stage
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/database/package.json ./packages/database/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm ci --include=optional --no-audit --ignore-scripts \
 && npm rebuild bcrypt --build-from-source

# Builder stage
FROM deps AS builder
COPY . .
# Some deployments don't include a public directory; ensure it exists for runner COPY.
RUN mkdir -p /app/apps/frontend/public
# Build the shared package first
RUN npm run build --workspace=@erp71/shared-types || true
# Generate Prisma client
RUN npm run generate --workspace=@erp71/database
# Build the frontend with debug info
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=1536"
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build --workspace=@erp71/frontend

# Runner stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# In monorepo standalone mode, the output is in apps/frontend/.next/standalone
# Copy the standalone output which includes node_modules
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Note: In monorepo standalone, the server file is inside the standalone project folder
CMD ["node", "apps/frontend/server.js"]

