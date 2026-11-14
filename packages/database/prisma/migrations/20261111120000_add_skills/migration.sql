-- Tenant-owned skill catalogue, assigned to people and to projects.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory, so this exists to keep the
-- migration history honest. `db push` emits the same CREATE TYPE / CREATE TABLE
-- statements for this schema diff: no DROP, no ALTER COLUMN, no backfill.

CREATE TYPE "SkillCategory" AS ENUM ('TECHNICAL', 'LANGUAGE', 'SOFT', 'TOOL', 'CERTIFICATION', 'OTHER');
CREATE TYPE "SkillProficiency" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');
CREATE TYPE "ProjectSkillRequirement" AS ENUM ('REQUIRED', 'NICE_TO_HAVE');

CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "SkillCategory" NOT NULL DEFAULT 'OTHER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "person_skills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "user_id" TEXT,
    "proficiency" "SkillProficiency" NOT NULL DEFAULT 'INTERMEDIATE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_skills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "requirement" "ProjectSkillRequirement" NOT NULL DEFAULT 'REQUIRED',
    "min_proficiency" "SkillProficiency",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skills_tenant_id_name_key" ON "skills"("tenant_id", "name");
CREATE INDEX "skills_tenant_id_deleted_at_idx" ON "skills"("tenant_id", "deleted_at");
CREATE INDEX "skills_tenant_id_is_active_idx" ON "skills"("tenant_id", "is_active");

CREATE UNIQUE INDEX "person_skills_skill_id_employee_id_key" ON "person_skills"("skill_id", "employee_id");
CREATE UNIQUE INDEX "person_skills_skill_id_user_id_key" ON "person_skills"("skill_id", "user_id");
CREATE INDEX "person_skills_tenant_id_employee_id_idx" ON "person_skills"("tenant_id", "employee_id");
CREATE INDEX "person_skills_tenant_id_user_id_idx" ON "person_skills"("tenant_id", "user_id");

CREATE UNIQUE INDEX "project_skills_project_id_skill_id_key" ON "project_skills"("project_id", "skill_id");
CREATE INDEX "project_skills_tenant_id_project_id_idx" ON "project_skills"("tenant_id", "project_id");

ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
