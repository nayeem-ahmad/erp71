-- Store-setup wizard state moves from per-browser localStorage to the workspace,
-- so skipping it once (typically by the owner) hides it for every member everywhere.
-- No backfill: existing tenants see the wizard at most one more time, and the next
-- skip/finish sticks for good.
ALTER TABLE "Tenant" ADD COLUMN "onboarding_dismissed_at" TIMESTAMP(3);
