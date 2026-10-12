-- Business apps the owner hid from the workspace's rail and Home tiles.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "hidden_apps" TEXT[] DEFAULT ARRAY[]::TEXT[];
