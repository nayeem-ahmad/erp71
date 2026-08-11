-- Recruitment: job posts, applicants, applications and their stage history.

CREATE TYPE "JobPostStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED');
CREATE TYPE "JobEmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY');
CREATE TYPE "JobApplicationStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "job_posts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" TEXT,
    "designation_id" TEXT,
    "employment_type" "JobEmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "location" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "salary_min" DECIMAL(12,2),
    "salary_max" DECIMAL(12,2),
    "description" TEXT,
    "requirements" TEXT,
    "status" "JobPostStatus" NOT NULL DEFAULT 'DRAFT',
    "opened_at" DATE,
    "closing_date" DATE,
    "hiring_manager_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "job_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "applicants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "current_company" TEXT,
    "current_designation" TEXT,
    "experience_years" DECIMAL(4,1),
    "expected_salary" DECIMAL(12,2),
    "resume_url" TEXT,
    "skills" TEXT,
    "notes" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_post_id" TEXT NOT NULL,
    "applicant_id" TEXT NOT NULL,
    "stage" "JobApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_salary" DECIMAL(12,2),
    "rating" INTEGER,
    "source" TEXT,
    "notes" TEXT,
    "rejection_reason" TEXT,
    "hired_employee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_application_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "from_stage" "JobApplicationStage",
    "to_stage" "JobApplicationStage" NOT NULL,
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_posts_tenant_id_code_key" ON "job_posts"("tenant_id", "code");
CREATE INDEX "job_posts_tenant_id_status_deleted_at_idx" ON "job_posts"("tenant_id", "status", "deleted_at");
CREATE INDEX "job_posts_tenant_id_department_id_idx" ON "job_posts"("tenant_id", "department_id");

CREATE UNIQUE INDEX "applicants_tenant_id_phone_key" ON "applicants"("tenant_id", "phone");
CREATE INDEX "applicants_tenant_id_deleted_at_idx" ON "applicants"("tenant_id", "deleted_at");

CREATE UNIQUE INDEX "job_applications_hired_employee_id_key" ON "job_applications"("hired_employee_id");
CREATE UNIQUE INDEX "job_applications_job_post_id_applicant_id_key" ON "job_applications"("job_post_id", "applicant_id");
CREATE INDEX "job_applications_tenant_id_stage_deleted_at_idx" ON "job_applications"("tenant_id", "stage", "deleted_at");
CREATE INDEX "job_applications_tenant_id_job_post_id_idx" ON "job_applications"("tenant_id", "job_post_id");
CREATE INDEX "job_applications_tenant_id_applicant_id_idx" ON "job_applications"("tenant_id", "applicant_id");

CREATE INDEX "job_application_events_tenant_id_application_id_created_at_idx" ON "job_application_events"("tenant_id", "application_id", "created_at");

ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_designation_id_fkey"
    FOREIGN KEY ("designation_id") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_hiring_manager_id_fkey"
    FOREIGN KEY ("hiring_manager_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "applicants" ADD CONSTRAINT "applicants_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_post_id_fkey"
    FOREIGN KEY ("job_post_id") REFERENCES "job_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicant_id_fkey"
    FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_hired_employee_id_fkey"
    FOREIGN KEY ("hired_employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "job_application_events" ADD CONSTRAINT "job_application_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_application_events" ADD CONSTRAINT "job_application_events_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_application_events" ADD CONSTRAINT "job_application_events_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
