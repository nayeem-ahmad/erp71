-- Hierarchical chart-of-accounts codes: <type><group> / +<subgroup> / +<account>.
--
-- The old flat account codes (1010, 5020, …) cannot be salvaged: 1050 "Fixed
-- Assets" is a Non-Current Asset but sits numerically inside the 10xx Current
-- Assets block, so no prefix rule holds over them. They are preserved in
-- accounts.legacy_code and every account is re-coded.
--
-- The backfill PINS the rows that came from DEFAULT_ACCOUNTING_TEMPLATE by name,
-- so an existing tenant ends up with exactly the codes a freshly bootstrapped
-- tenant gets -- "110101 is Cash in Hand" has to be true everywhere for support
-- to be able to lean on it. Anything a tenant added themselves is allocated
-- after the pinned rows, monotonically from the highest serial in use.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE "account_groups" ADD COLUMN "code" VARCHAR(2);
ALTER TABLE "account_subgroups" ADD COLUMN "code" VARCHAR(4);
ALTER TABLE "accounts" ADD COLUMN "legacy_code" TEXT;

UPDATE "accounts" SET "legacy_code" = "code" WHERE "code" IS NOT NULL;
UPDATE "accounts" SET "code" = NULL;
ALTER TABLE "accounts" ALTER COLUMN "code" TYPE VARCHAR(6);

-- ---------------------------------------------------------------------------
-- 2. Serial codec -- the SQL twin of prisma/account-code.ts
-- ---------------------------------------------------------------------------
CREATE FUNCTION erp71_encode_serial(serial INT, width INT) RETURNS TEXT AS $$
DECLARE
    b36 TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    decimal_max INT := CASE WHEN width = 1 THEN 9 ELSE 99 END;
    limit_ INT := CASE WHEN width = 1 THEN 35 ELSE 1035 END;
    offset_ INT;
BEGIN
    IF serial < 1 THEN
        RAISE EXCEPTION 'Account code serial must be positive, got %', serial;
    END IF;
    IF serial <= decimal_max THEN
        RETURN lpad(serial::TEXT, width, '0');
    END IF;
    IF serial > limit_ THEN
        RAISE EXCEPTION 'Account code serial % overflows % character(s); split the parent group.', serial, width;
    END IF;
    -- Decimal is full, so spill into base-36 at the same width. '9' < 'A' in
    -- ASCII, which is what keeps a plain lexicographic sort in hierarchy order.
    offset_ := serial - decimal_max - 1;
    IF width = 1 THEN
        RETURN substr(b36, 11 + offset_, 1);
    END IF;
    RETURN substr(b36, 11 + (offset_ / 36), 1) || substr(b36, 1 + (offset_ % 36), 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION erp71_decode_serial(text_ TEXT, width INT) RETURNS INT AS $$
DECLARE
    b36 TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    decimal_max INT := CASE WHEN width = 1 THEN 9 ELSE 99 END;
    head INT;
    tail INT;
BEGIN
    IF text_ IS NULL THEN
        RETURN NULL;
    END IF;
    IF text_ ~ '^[0-9]+$' THEN
        RETURN text_::INT;
    END IF;
    head := strpos(b36, substr(text_, 1, 1)) - 1;
    IF head < 10 THEN
        RETURN NULL;
    END IF;
    IF width = 1 THEN
        RETURN decimal_max + 1 + (head - 10);
    END IF;
    tail := strpos(b36, substr(text_, 2, 1)) - 1;
    IF tail < 0 THEN
        RETURN NULL;
    END IF;
    RETURN decimal_max + 1 + (head - 10) * 36 + tail;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION erp71_type_digit(type_ TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN CASE type_
        WHEN 'asset' THEN '1'
        WHEN 'liability' THEN '2'
        WHEN 'equity' THEN '3'
        WHEN 'revenue' THEN '4'
        WHEN 'expense' THEN '5'
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 3. Groups: pin the template, then allocate the rest
-- ---------------------------------------------------------------------------
UPDATE "account_groups" g
SET "code" = pinned.code
FROM (VALUES
    ('Current Assets', 'asset', '11'),
    ('Non-Current Assets', 'asset', '12'),
    ('Current Liabilities', 'liability', '21'),
    ('Owner Equity', 'equity', '31'),
    ('Operating Revenue', 'revenue', '41'),
    ('Operating Expenses', 'expense', '51')
) AS pinned(name, type, code)
WHERE g."name" = pinned.name AND g."type" = pinned.type;

WITH used AS (
    SELECT "tenant_id", "type", MAX(erp71_decode_serial(right("code", 1), 1)) AS max_serial
    FROM "account_groups"
    WHERE "code" IS NOT NULL
    GROUP BY "tenant_id", "type"
),
pending AS (
    SELECT
        "id",
        "tenant_id",
        "type",
        row_number() OVER (
            PARTITION BY "tenant_id", "type"
            ORDER BY "created_at", "name", "id"
        ) AS rn
    FROM "account_groups"
    WHERE "code" IS NULL
)
UPDATE "account_groups" g
SET "code" = erp71_type_digit(pending."type")
    || erp71_encode_serial((COALESCE(used.max_serial, 0) + pending.rn)::INT, 1)
FROM pending
LEFT JOIN used ON used."tenant_id" = pending."tenant_id" AND used."type" = pending."type"
WHERE g."id" = pending."id";

-- A group type outside the five known values would yield a NULL digit; fail loud
-- rather than leave the chart of accounts half-coded.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "account_groups" WHERE "code" IS NULL) THEN
        RAISE EXCEPTION 'Some account groups have an unrecognised type and could not be coded.';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Subgroups
-- ---------------------------------------------------------------------------
UPDATE "account_subgroups" s
SET "code" = pinned.code
FROM (VALUES
    ('Current Assets', 'Cash and Bank', '1101'),
    ('Current Assets', 'Receivables', '1102'),
    ('Current Assets', 'Loans Receivable', '1103'),
    ('Current Assets', 'Inter-Branch Clearing', '1104'),
    ('Non-Current Assets', 'Fixed Assets', '1201'),
    ('Current Liabilities', 'Trade Payables', '2101'),
    ('Current Liabilities', 'Loans Payable', '2102'),
    ('Current Liabilities', 'Payroll', '2103'),
    ('Current Liabilities', 'Inter-Branch Clearing', '2104'),
    ('Owner Equity', 'Capital', '3101'),
    ('Operating Revenue', 'Sales', '4101'),
    ('Operating Expenses', 'Cost of Sales', '5101'),
    ('Operating Expenses', 'General Expenses', '5102')
) AS pinned(group_name, name, code)
WHERE s."name" = pinned.name
  AND EXISTS (
      SELECT 1 FROM "account_groups" g
      WHERE g."id" = s."group_id"
        AND g."name" = pinned.group_name
        AND g."code" = left(pinned.code, 2)
  );

WITH used AS (
    SELECT "group_id", MAX(erp71_decode_serial(right("code", 2), 2)) AS max_serial
    FROM "account_subgroups"
    WHERE "code" IS NOT NULL
    GROUP BY "group_id"
),
pending AS (
    SELECT
        s."id",
        s."group_id",
        g."code" AS group_code,
        row_number() OVER (
            PARTITION BY s."group_id"
            ORDER BY s."created_at", s."name", s."id"
        ) AS rn
    FROM "account_subgroups" s
    JOIN "account_groups" g ON g."id" = s."group_id"
    WHERE s."code" IS NULL
)
UPDATE "account_subgroups" s
SET "code" = pending.group_code
    || erp71_encode_serial((COALESCE(used.max_serial, 0) + pending.rn)::INT, 2)
FROM pending
LEFT JOIN used ON used."group_id" = pending."group_id"
WHERE s."id" = pending."id";

-- ---------------------------------------------------------------------------
-- 5. Accounts
-- ---------------------------------------------------------------------------
UPDATE "accounts" a
SET "code" = pinned.code
FROM (VALUES
    ('Cash and Bank', 'Cash in Hand', '110101'),
    ('Cash and Bank', 'Main Bank Account', '110102'),
    ('Cash and Bank', 'bKash Account', '110103'),
    ('Cash and Bank', 'Nagad Account', '110104'),
    ('Receivables', 'Accounts Receivable', '110201'),
    ('Receivables', 'Staff Advances', '110202'),
    ('Loans Receivable', 'Loans Receivable', '110301'),
    ('Inter-Branch Clearing', 'Due from Branches', '110401'),
    ('Fixed Assets', 'Fixed Assets', '120101'),
    ('Fixed Assets', 'Accumulated Depreciation', '120102'),
    ('Trade Payables', 'Purchase Payable', '210101'),
    ('Loans Payable', 'Loans Payable', '210201'),
    ('Payroll', 'Salary Payable', '210301'),
    ('Inter-Branch Clearing', 'Due to Branches', '210401'),
    ('Capital', 'Owner''s Equity', '310101'),
    ('Sales', 'Sales Revenue', '410101'),
    ('Cost of Sales', 'Purchases', '510101'),
    ('General Expenses', 'General Operating Expense', '510201'),
    ('General Expenses', 'Salary & Wages', '510202'),
    ('General Expenses', 'Depreciation Expense', '510203')
) AS pinned(subgroup_name, name, code)
WHERE a."name" = pinned.name
  -- Only pin when the account still sits where the template put it. A tenant
  -- who moved it elsewhere gets an allocated code instead, so the prefix
  -- invariant holds rather than the pinned code lying about its parent.
  AND EXISTS (
      SELECT 1 FROM "account_subgroups" sg
      WHERE sg."id" = a."subgroup_id"
        AND sg."name" = pinned.subgroup_name
        AND sg."code" = left(pinned.code, 4)
  );

WITH parented AS (
    SELECT
        a."id",
        a."tenant_id",
        a."code",
        a."legacy_code",
        a."created_at",
        a."name",
        COALESCE(sg."code", g."code" || '00') AS parent_code
    FROM "accounts" a
    JOIN "account_groups" g ON g."id" = a."group_id"
    LEFT JOIN "account_subgroups" sg ON sg."id" = a."subgroup_id"
),
used AS (
    SELECT "tenant_id", parent_code, MAX(erp71_decode_serial(right("code", 2), 2)) AS max_serial
    FROM parented
    WHERE "code" IS NOT NULL
    GROUP BY "tenant_id", parent_code
),
pending AS (
    SELECT
        "id",
        "tenant_id",
        parent_code,
        row_number() OVER (
            PARTITION BY "tenant_id", parent_code
            ORDER BY "legacy_code" NULLS LAST, "created_at", "name", "id"
        ) AS rn
    FROM parented
    WHERE "code" IS NULL
)
UPDATE "accounts" a
SET "code" = pending.parent_code
    || erp71_encode_serial((COALESCE(used.max_serial, 0) + pending.rn)::INT, 2)
FROM pending
LEFT JOIN used
    ON used."tenant_id" = pending."tenant_id" AND used.parent_code = pending.parent_code
WHERE a."id" = pending."id";

-- ---------------------------------------------------------------------------
-- 6. Lock it down
-- ---------------------------------------------------------------------------
ALTER TABLE "account_groups" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "account_subgroups" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "accounts" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "account_groups_tenant_id_code_key" ON "account_groups"("tenant_id", "code");
CREATE UNIQUE INDEX "account_subgroups_tenant_id_code_key" ON "account_subgroups"("tenant_id", "code");
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");
CREATE INDEX "accounts_tenant_id_code_idx" ON "accounts"("tenant_id", "code");

DROP FUNCTION erp71_encode_serial(INT, INT);
DROP FUNCTION erp71_decode_serial(TEXT, INT);
DROP FUNCTION erp71_type_digit(TEXT);
