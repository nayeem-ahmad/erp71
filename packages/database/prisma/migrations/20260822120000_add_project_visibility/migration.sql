-- Public/private projects. A private project is reachable only by its members,
-- its manager, the workspace OWNER, and holders of VIEW_ALL_PROJECTS.

-- The permission goes in first: UserStorePermission.permission is this enum, so
-- a grant cannot be written at all until the value exists. Nobody is granted it
-- here — OWNER already bypasses every permission check, so the strict reading
-- of "private" holds until a tenant hands it out deliberately.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_ALL_PROJECTS';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ProjectVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
-- PUBLIC for every existing row: nothing was private before this column, and
-- defaulting the other way would hide every project a tenant already has.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "visibility" "ProjectVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateIndex
-- Every list request from a non-owner filters on it.
CREATE INDEX IF NOT EXISTS "projects_tenant_id_visibility_deleted_at_idx" ON "projects"("tenant_id", "visibility", "deleted_at");
