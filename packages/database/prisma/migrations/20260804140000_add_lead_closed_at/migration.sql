-- Lead.closed_at — when a lead reached CONVERTED or LOST.
--
-- The CRM dashboard counts won and lost deals *within a window*, and nothing on
-- the row could answer that: `updated_at` moves on any later edit, so a lead
-- converted in June and re-tagged in August would count as an August win.
ALTER TABLE "Lead" ADD COLUMN "closed_at" TIMESTAMP(3);

-- Backfill for rows that closed before this column existed. `updated_at` is an
-- approximation — it is the close date only for leads untouched since — but it is
-- the best signal on the row, and leaving these NULL would drop every historical
-- deal out of the dashboard's period counts entirely.
UPDATE "Lead"
SET "closed_at" = "updated_at"
WHERE "status" IN ('CONVERTED', 'LOST') AND "closed_at" IS NULL;

CREATE INDEX "Lead_tenant_id_status_closed_at_idx" ON "Lead"("tenant_id", "status", "closed_at");
CREATE INDEX "Lead_tenant_id_created_at_idx" ON "Lead"("tenant_id", "created_at");
