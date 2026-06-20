-- Seed the ACCOUNTING reference plan row (idempotent, mirrors prisma/seed.ts).
-- Kept in a separate migration from the enum change: Postgres does not allow a
-- newly-added enum value to be used in the same transaction that adds it.
INSERT INTO "SubscriptionPlan" (
    "id", "code", "name", "description", "monthly_price", "yearly_price", "features_json", "is_active"
)
VALUES (
    gen_random_uuid()::text,
    'ACCOUNTING',
    'Accounting',
    'Focused pack for bookkeeping: full accounting module, financial reports, expenses, and fund management',
    749,
    7490,
    '{"maxStores":1,"maxUsers":5,"maxSkus":5000,"premiumAccounting":true,"premiumInventoryReports":false,"multiStore":false}'::jsonb,
    true
)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "monthly_price" = EXCLUDED."monthly_price",
    "yearly_price" = EXCLUDED."yearly_price",
    "features_json" = EXCLUDED."features_json",
    "is_active" = EXCLUDED."is_active";
