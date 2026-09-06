-- Subscription pricing redesign, Phase 0 — reprice. APPLIED TO PRODUCTION 2026-09-06.
--
-- Kept as the record of what was run, not as something to run again. It is a
-- one-off by nature and deliberately NOT in the Dockerfile CMD alongside the
-- sync scripts: re-running it on every deploy would fight the platform admin
-- UI, which is exactly the problem `seed-platform.ts` was rewritten to stop.
--
-- Why SQL and not `seed-platform.ts`: that file is create-once-then-additive on
-- purpose. On a row that already exists it only adds missing `features_json`
-- keys and never rewrites name, description, price or `is_active`, because it
-- used to revert every admin edit on every deploy. So the new prices sat in the
-- seed from 2026-09-03 and could never reach a database where the rows already
-- existed. Production ran the pre-reprice catalog until this was applied.
--
-- The grandfathering is NOT a blanket write. Two of the nine active Business
-- subscriptions already carried admin-granted discounts, and a flat `FIXED
-- 1000` would have started billing a tenant comped at 100% and nearly doubled
-- one paying a reduced rate. The rule is "preserve the taka each tenant pays
-- today": add to an existing FIXED grant, and leave PERCENTAGE grants alone.
--
-- Known limit: `applySubscriptionDiscount` takes the FIXED amount off whatever
-- cycle amount is being charged. Renewals always bill `monthly_price`, so the
-- 1000 is exact there. A grandfathered tenant who lapses and re-checks-out on a
-- YEARLY cycle gets 1000 off 24990 rather than the 10000 that would hold their
-- old annual rate. Pre-existing in the discount model, newly reachable here.

-- Phase 0 reprice + grandfathering. Run ONCE, inside one transaction.
--
-- Guarded on PREMIUM still being at 1499: the grandfathering discount is
-- computed from the old price, so a second run would stack another 1000 onto
-- everyone. If PREMIUM is already 2499 the whole script raises and rolls back.
BEGIN;

DO $$
BEGIN
    IF (SELECT monthly_price FROM "SubscriptionPlan" WHERE code = 'PREMIUM') <> 1499 THEN
        RAISE EXCEPTION 'PREMIUM is not at the pre-reprice price of 1499 — already run?';
    END IF;
END $$;

-- 1. Grandfather ACTIVE PREMIUM subscribers, BEFORE the price moves.
--    Rule: preserve the taka each tenant pays today.
--
--    PERCENTAGE grants are deliberately untouched: a percentage is relative to
--    whatever the plan costs, so a 100% comp stays a comp across a reprice.
--    Rewriting it as a FIXED amount would turn a durable "this tenant is free"
--    into a number that silently starts billing them at the next reprice.
UPDATE "TenantSubscription" ts
SET discount_type = 'FIXED',
    discount_value = COALESCE(ts.discount_value, 0) + 1000
FROM "SubscriptionPlan" p
WHERE p.id = ts.plan_id
  AND p.code = 'PREMIUM'
  AND ts.status = 'ACTIVE'
  AND (ts.discount_type IS NULL OR ts.discount_type = 'FIXED');

-- 2. The catalog itself, aligned to packages/database/prisma/seed-platform.ts.
UPDATE "SubscriptionPlan" SET
    name = 'Starter',
    description = 'One counter, one owner, a couple of staff — ring up sales and know what is in stock',
    monthly_price = 299, yearly_price = 2990, setup_fee = 0
WHERE code = 'BASIC';

UPDATE "SubscriptionPlan" SET
    name = 'Growth',
    description = 'A real business with books to close, a second branch, and someone chasing customers',
    monthly_price = 999, yearly_price = 9990, setup_fee = 4000
WHERE code = 'STANDARD';

UPDATE "SubscriptionPlan" SET
    name = 'Business',
    description = 'Multi-branch operators who run payroll, manufacture, or import',
    monthly_price = 2499, yearly_price = 24990, setup_fee = 15000
WHERE code = 'PREMIUM';

COMMIT;
