-- Lead de-duplication keys.
--
-- Until now the only thing stopping a duplicate lead was UNIQUE(tenant_id, mobile)
-- on the raw column, which compares strings: `01712-345678`, `+8801712345678` and
-- `01712345678` all imported as three separate leads, and email / LinkedIn were
-- not checked at all. This adds normalized copies of the three identity fields
-- and puts the uniqueness on those instead.
--
-- The normalization here MUST stay in step with
-- packages/shared-types/lead-identity.ts, which is what writes these
-- columns from now on.

-- 1. The columns.
ALTER TABLE "Lead" ADD COLUMN "mobile_norm"   TEXT;
ALTER TABLE "Lead" ADD COLUMN "email_norm"    TEXT;
ALTER TABLE "Lead" ADD COLUMN "linkedin_norm" TEXT;

-- 2. Normalization, mirroring the TypeScript helper. Dropped again at the end:
--    the application writes these columns, the database only enforces them.
CREATE FUNCTION "erp71_backfill_norm_mobile"(raw TEXT) RETURNS TEXT AS $$
DECLARE digits TEXT; national TEXT;
BEGIN
    IF raw IS NULL THEN RETURN NULL; END IF;
    digits := regexp_replace(raw, '\D', '', 'g');
    IF digits = '' THEN RETURN NULL; END IF;

    -- E.164 for the BD numbers that make up nearly every lead, so every spelling
    -- collapses onto one string.
    national := digits;
    IF left(national, 3) = '880' THEN national := substr(national, 4); END IF;
    IF left(national, 1) = '0'   THEN national := substr(national, 2); END IF;
    IF length(national) BETWEEN 7 AND 11 THEN RETURN '+880' || national; END IF;

    -- Anything E.164 rejects (a foreign number, an extension) still needs a
    -- stable form, or two spellings of it would both survive.
    RETURN digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION "erp71_backfill_norm_url"(raw TEXT) RETURNS TEXT AS $$
DECLARE value TEXT;
BEGIN
    IF raw IS NULL THEN RETURN NULL; END IF;
    value := lower(btrim(raw));
    value := regexp_replace(value, '^[a-z][a-z0-9+.-]*://', '');
    value := regexp_replace(value, '^www\.', '');
    value := regexp_replace(value, '[?#].*$', '');
    value := regexp_replace(value, '/+$', '');
    RETURN nullif(value, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Backfill.
UPDATE "Lead" SET
    "mobile_norm"   = "erp71_backfill_norm_mobile"("mobile"),
    "email_norm"    = nullif(lower(btrim("email")), ''),
    "linkedin_norm" = "erp71_backfill_norm_url"("linkedin_url");

DROP FUNCTION "erp71_backfill_norm_mobile"(TEXT);
DROP FUNCTION "erp71_backfill_norm_url"(TEXT);

-- 4. Resolve the duplicates already in the data, so step 5 cannot fail and take
--    a production deploy down with it. The oldest lead carrying a given value
--    keeps it; the later ones have only their *normalized* column cleared —
--    `mobile` / `email` / `linkedin_url` are untouched, so nothing a user can see
--    is lost and no lead disappears. Those leads are simply unprotected against a
--    future collision until someone merges them by hand.
--
--    `scripts/lead-duplicates.ts` lists exactly which leads these are (and can
--    delete the ones carrying no history); it
--    reads the raw columns, so it stays accurate after this runs.
UPDATE "Lead" l SET "mobile_norm" = NULL
WHERE l."mobile_norm" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Lead" k
    WHERE k."tenant_id" = l."tenant_id" AND k."mobile_norm" = l."mobile_norm"
      AND (k."created_at", k."id") < (l."created_at", l."id")
);

UPDATE "Lead" l SET "email_norm" = NULL
WHERE l."email_norm" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Lead" k
    WHERE k."tenant_id" = l."tenant_id" AND k."email_norm" = l."email_norm"
      AND (k."created_at", k."id") < (l."created_at", l."id")
);

UPDATE "Lead" l SET "linkedin_norm" = NULL
WHERE l."linkedin_norm" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Lead" k
    WHERE k."tenant_id" = l."tenant_id" AND k."linkedin_norm" = l."linkedin_norm"
      AND (k."created_at", k."id") < (l."created_at", l."id")
);

-- 5. The constraints. NULLs are distinct under a Postgres unique index, so a
--    lead missing an email is never in anyone's way.
CREATE UNIQUE INDEX "Lead_tenant_id_mobile_norm_key"   ON "Lead"("tenant_id", "mobile_norm");
CREATE UNIQUE INDEX "Lead_tenant_id_email_norm_key"    ON "Lead"("tenant_id", "email_norm");
CREATE UNIQUE INDEX "Lead_tenant_id_linkedin_norm_key" ON "Lead"("tenant_id", "linkedin_norm");

-- 6. The raw-string mobile unique is now strictly weaker than the normalized one
--    (two raw-equal mobiles always normalize equal), so it only costs writes.
DROP INDEX "Lead_tenant_id_mobile_key";
