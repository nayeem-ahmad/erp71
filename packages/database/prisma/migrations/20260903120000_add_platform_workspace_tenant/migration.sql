-- The platform's own internal workspace.
--
-- Project management (projects, tasks, boards, sprints, hour logs) is scoped to
-- a tenant end to end — every table carries `tenant_id`, every query is filtered
-- by `TenantInterceptor`. Platform staff had no tenant at all, so the module was
-- simply unreachable from the admin console.
--
-- Rather than teach two dozen tables a second, tenant-less scope, the platform
-- team gets one real tenant marked here. Everything downstream works unchanged;
-- what the marker buys is the ability to keep this row out of the places that
-- mean "customer" — tenant listings, platform metrics, and the account chooser.
--
-- It is a nullable unique TEXT rather than the boolean it obviously wants to be.
-- "At most one platform workspace" over a boolean needs a partial unique index,
-- which Prisma's schema language cannot express — so it would live only in this
-- file, and production applies the schema with `prisma db push`, which never
-- runs migrations (see apps/backend/Dockerfile). Postgres allows any number of
-- NULLs under a UNIQUE constraint and exactly one non-NULL value, which is the
-- same guarantee in a form `db push` reproduces from schema.prisma alone.
ALTER TABLE "Tenant" ADD COLUMN "platform_workspace_key" TEXT;

CREATE UNIQUE INDEX "Tenant_platform_workspace_key_key"
    ON "Tenant"("platform_workspace_key");
