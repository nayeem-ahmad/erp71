-- The Manufacturing controller now gates on the `premiumManufacturing` feature
-- key instead of plan rank directly (see ManufacturingController). Backfill the
-- entitlement onto the existing PREMIUM plan row so already-deployed PREMIUM
-- tenants keep access without interruption.
UPDATE "SubscriptionPlan"
SET "features_json" = "features_json" || '{"premiumManufacturing": true}'::jsonb
WHERE "code" = 'PREMIUM';
