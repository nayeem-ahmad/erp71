-- Per-tenant overrides of the platform-wide feature switches.
-- `{}` means the tenant inherits every platform default.
ALTER TABLE "Tenant" ADD COLUMN "feature_overrides" JSONB NOT NULL DEFAULT '{}';
