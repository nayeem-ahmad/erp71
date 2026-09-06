-- Recorded consent at signup.
--
-- Agreement to the Terms of Service was previously implied by pressing "Create
-- workspace" under a line of grey text, and nothing was written down. That is
-- both weak consent and unauditable: there was no way to say who agreed, when,
-- or to which version of a document that changes.
--
-- Append-only by convention — nothing in the application updates or deletes a
-- row. Re-acceptance after a version bump inserts a second row so the earlier
-- one keeps naming the document that person actually saw.
--
-- `plan_code` is a plain TEXT rather than a foreign key to SubscriptionPlan on
-- purpose: the terms are tier-specific, so the tier is part of what was agreed,
-- and the record has to outlive the plan being renamed, repriced or retired.
CREATE TABLE "TermsAcceptance" (
    "id"            TEXT NOT NULL,
    "user_id"       TEXT NOT NULL,
    "tenant_id"     TEXT,
    "terms_version" TEXT NOT NULL,
    "plan_code"     TEXT,
    "source"        TEXT NOT NULL,
    "ip_address"    TEXT,
    "user_agent"    TEXT,
    "accepted_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TermsAcceptance_user_id_accepted_at_idx"
    ON "TermsAcceptance"("user_id", "accepted_at");

CREATE INDEX "TermsAcceptance_tenant_id_idx"
    ON "TermsAcceptance"("tenant_id");

ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL rather than CASCADE: deleting a workspace must not erase the record
-- that its owner accepted the terms.
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
