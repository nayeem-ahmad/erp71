-- The platform's own internal workspace.
--
-- Project management (projects, tasks, boards, sprints, hour logs) is scoped to
-- a tenant end to end — every table carries `tenant_id`, every query is filtered
-- by `TenantInterceptor`. Platform staff had no tenant at all, so the module was
-- simply unreachable from the admin console.
--
-- Rather than teach two dozen tables a second, tenant-less scope, the platform
-- team gets one real tenant flagged here. Everything downstream works unchanged;
-- what the flag buys is the ability to keep this row out of the places that mean
-- "customer" — tenant listings, platform metrics, and the account chooser.
--
-- Exactly one such row is expected. The partial unique index enforces that at
-- the database rather than leaving it to a service that could race with itself.
ALTER TABLE "Tenant" ADD COLUMN "is_platform_workspace" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Tenant_is_platform_workspace_idx" ON "Tenant"("is_platform_workspace");

CREATE UNIQUE INDEX "Tenant_single_platform_workspace_idx"
    ON "Tenant"("is_platform_workspace")
    WHERE "is_platform_workspace" = true AND "deleted_at" IS NULL;
