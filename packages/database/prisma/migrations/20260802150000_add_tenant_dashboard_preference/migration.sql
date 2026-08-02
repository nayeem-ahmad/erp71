-- Which dashboard a workspace lands on. AUTO defers to the plan's
-- `accountingDashboard` entitlement, so every existing tenant keeps the
-- behaviour it has today.
--
-- Additive only: one NOT NULL column with a default, so this is safe under the
-- production boot chain's `prisma db push --accept-data-loss`.
ALTER TABLE "Tenant" ADD COLUMN "dashboard_preference" TEXT NOT NULL DEFAULT 'AUTO';
