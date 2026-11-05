-- Designation master: codes, levels, departments and reporting lines.
-- Every new column is nullable or defaulted, so existing rows need no backfill.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "code" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "reports_to" TEXT,
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "designation_levels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "designation_levels_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN "code" TEXT,
ADD COLUMN "department_id" TEXT,
ADD COLUMN "level_id" TEXT,
ADD COLUMN "reports_to_id" TEXT,
ADD COLUMN "reports_to_note" TEXT,
ADD COLUMN "remarks" TEXT,
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenant_id_code_key" ON "Department"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "designation_levels_tenant_id_level_key" ON "designation_levels"("tenant_id", "level");

-- CreateIndex
CREATE INDEX "designation_levels_tenant_id_deleted_at_idx" ON "designation_levels"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_tenant_id_code_key" ON "Designation"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "Designation_tenant_id_department_id_idx" ON "Designation"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "Designation_tenant_id_level_id_idx" ON "Designation"("tenant_id", "level_id");

-- AddForeignKey
ALTER TABLE "designation_levels" ADD CONSTRAINT "designation_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "designation_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_reports_to_id_fkey" FOREIGN KEY ("reports_to_id") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
