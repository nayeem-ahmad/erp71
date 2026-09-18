-- Writing off a customer receivable the shop has given up on collecting.
--
-- Dr Bad Debt Expense / Cr Accounts Receivable, tagged to the customer so the
-- write-off shows on their subsidiary ledger. The sale's revenue stays
-- recognised: what failed is collection, not the sale, so the loss is an
-- expense rather than a reversal of Sales Revenue.
--
-- The 'Bad Debt Expense' account (510204) and the posting rule that names it
-- are provisioned by DEFAULT_ACCOUNTING_TEMPLATE / DEFAULT_POSTING_RULES and
-- carried to existing tenants by `npm run sync:accounting`, which runs on every
-- container start. Neither belongs in this file: they are per-tenant rows, not
-- schema.
--
-- The write-off transaction itself needs no table. It is a
-- CustomerCreditTransaction with type 'WRITE_OFF', and that column is a plain
-- String rather than an enum.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'bad_debt_write_off';

-- The permission that gates the write-off. `StorePermission` is a Postgres enum
-- as well as a TypeScript const, and `seedDefaultTenantRoles` writes a
-- TenantRolePermission row per granted permission at tenant creation — so a
-- value present only in `packages/shared-types` makes every signup fail with
-- "Invalid value for argument `permission`", not just the write-off route.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'WRITE_OFF_CUSTOMER_DEBT';
