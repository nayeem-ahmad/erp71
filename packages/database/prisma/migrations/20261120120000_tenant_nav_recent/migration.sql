-- The sidebar's "Recent" menu items, switchable per workspace. On by default. Additive.
ALTER TABLE "Tenant" ADD COLUMN "nav_recent_enabled" BOOLEAN NOT NULL DEFAULT true;
