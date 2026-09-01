-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "last_activity_at" TIMESTAMP(3);

-- Backfill: "when did anyone last work this lead", from the real event times.
--
-- Deliberately NOT `CrmActivity.updated_at` on its own. sync-crm-activities
-- backfilled the R1 activity table from LeadConversation / CrmFollowUp without
-- preserving the source rows' timestamps, so every backfilled activity carries
-- the backfill run's created_at/updated_at. Trusting those would stamp half the
-- book as freshly worked and empty the neglected-leads tile overnight.
--
-- So each source contributes a timestamp that means something:
--   * last_contacted_at        — every contact is also activity
--   * LeadConversation.created_at — when the conversation was logged
--   * CrmActivity.completed_at — preserved by the backfill; genuine for DONE rows
--   * CrmActivity.updated_at   — genuine only on user-created rows (no legacy_source)
--   * CrmFollowUp.created_at / completed_at — never backfilled, so genuine
--
-- GREATEST ignores NULL arguments and yields NULL only when all of them are
-- NULL, which is exactly right: a lead nobody has ever worked stays NULL and
-- the stale query falls back to created_at for it.
UPDATE "Lead" l
SET "last_activity_at" = GREATEST(
    l."last_contacted_at",
    (SELECT MAX(c."created_at") FROM "LeadConversation" c WHERE c."lead_id" = l."id"),
    (
        SELECT MAX(GREATEST(
            a."completed_at",
            CASE WHEN a."legacy_source" IS NULL THEN a."updated_at" END
        ))
        FROM "CrmActivity" a WHERE a."lead_id" = l."id"
    ),
    (
        SELECT MAX(GREATEST(f."created_at", f."completed_at"))
        FROM "CrmFollowUp" f WHERE f."lead_id" = l."id"
    )
);
