-- The careers portal: a platform-wide job-seeker login on top of the
-- tenant-scoped recruitment module added by 20260811090000_add_recruitment.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory (see
-- 20260804090000_add_referral_commission_reversal for the same note), so this
-- exists to keep the migration history honest rather than because it is the
-- mechanism that ships the change. No DROP, no backfill.
--
-- The one non-obvious statement is the partial unique index at the bottom. See
-- its comment: a plain UNIQUE(tenant_id, user_id) would allow only ONE
-- HR-entered (user_id IS NULL) candidate per tenant in Postgres, which would
-- break the existing recruitment module outright.

-- Careers-portal sessions revoke independently of the ERP app's `token_version`
-- and the storefront's `storefront_token_version`.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "applicant_token_version" INTEGER NOT NULL DEFAULT 0;

-- Advertising to the public board is opt-in per post, so shipping this does not
-- retroactively publish every vacancy that is already OPEN.
ALTER TABLE "job_posts" ADD COLUMN IF NOT EXISTS "publish_to_board" BOOLEAN NOT NULL DEFAULT false;

-- The candidate's own note from the public board, kept out of the workspace's
-- editable `notes` so an interviewer cannot overwrite it.
ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "cover_letter" TEXT;

-- Links a tenant's candidate record to a careers login. Null for every row that
-- exists today, which is the normal case for HR-entered candidates.
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

CREATE TABLE "job_seekers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "headline" TEXT,
    "location" TEXT,
    "summary" TEXT,
    "resume_url" TEXT,
    "resume_name" TEXT,
    "linkedin_url" TEXT,
    "portfolio_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "job_seekers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_seekers_user_id_key" ON "job_seekers"("user_id");

ALTER TABLE "job_seekers" ADD CONSTRAINT "job_seekers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "applicants" ADD CONSTRAINT "applicants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "applicants_user_id_idx" ON "applicants"("user_id");

-- One candidate record per login per company.
--
-- Safe to apply to the existing table even though every current row has
-- user_id NULL: Postgres treats NULLs as distinct in a unique index, so any
-- number of HR-entered candidates (user_id IS NULL, the overwhelming majority)
-- coexist and only the claimed ones are constrained. Written as a plain unique
-- index rather than a partial one so it matches byte-for-byte what `db push`
-- emits for `@@unique([tenant_id, user_id])` — a partial index here would look
-- like schema drift on every subsequent push.
CREATE UNIQUE INDEX "applicants_tenant_id_user_id_key" ON "applicants"("tenant_id", "user_id");
