-- Default preference profiles for new staff.
-- Schema only. Production applies the schema with `db push`, which never runs
-- migration data steps, so the data work (legacy_browser_sections, the invoice
-- layout fill-out and the one-shot marker) lives in
-- prisma/sync-member-prefs-legacy.ts and runs in every environment. Local and
-- dev databases run it by hand:
--   npm run sync:member-prefs-legacy --workspace=@erp71/database

-- CreateTable
CREATE TABLE IF NOT EXISTS "preference_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "prefs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "preference_profiles_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TenantRole" ADD COLUMN IF NOT EXISTS "preference_profile_id" TEXT;

-- AlterTable
ALTER TABLE "TenantUser" ADD COLUMN IF NOT EXISTS "preferences" JSONB;
ALTER TABLE "TenantUser" ADD COLUMN IF NOT EXISTS "legacy_browser_sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX IF NOT EXISTS "preference_profiles_tenant_id_idx" ON "preference_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "preference_profiles_tenant_id_name_key" ON "preference_profiles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantRole_preference_profile_id_idx" ON "TenantRole"("preference_profile_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preference_profiles_tenant_id_fkey') THEN
        ALTER TABLE "preference_profiles" ADD CONSTRAINT "preference_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TenantRole_preference_profile_id_fkey') THEN
        ALTER TABLE "TenantRole" ADD CONSTRAINT "TenantRole_preference_profile_id_fkey" FOREIGN KEY ("preference_profile_id") REFERENCES "preference_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
