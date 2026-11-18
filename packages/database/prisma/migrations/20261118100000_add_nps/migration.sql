-- KPI scorecard, phase 4: Net Promoter Score capture and the customer lapse window.
-- Production applies schema via `prisma db push`; this file is the history.

ALTER TABLE "SalesSettings" ADD COLUMN "nps_survey_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SalesSettings" ADD COLUMN "customer_lapse_days" INTEGER NOT NULL DEFAULT 90;

CREATE TABLE "nps_invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "sale_id" TEXT,
    "customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "nps_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "nps_invites_code_key" ON "nps_invites"("code");
CREATE INDEX "nps_invites_tenant_id_created_at_idx" ON "nps_invites"("tenant_id", "created_at");

CREATE TABLE "nps_responses" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "customer_id" TEXT,
    "user_id" TEXT,
    "invite_id" TEXT,
    "score" INTEGER,
    "comment" TEXT,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "nps_responses_invite_id_key" ON "nps_responses"("invite_id");
CREATE INDEX "nps_responses_audience_tenant_id_created_at_idx" ON "nps_responses"("audience", "tenant_id", "created_at");
CREATE INDEX "nps_responses_audience_created_at_idx" ON "nps_responses"("audience", "created_at");
CREATE INDEX "nps_responses_user_id_audience_created_at_idx" ON "nps_responses"("user_id", "audience", "created_at");
