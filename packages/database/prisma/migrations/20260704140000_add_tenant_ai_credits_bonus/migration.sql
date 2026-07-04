-- Purchased / admin-granted AI credits added on top of the plan monthly allowance.
ALTER TABLE "Tenant" ADD COLUMN "ai_credits_bonus" INTEGER NOT NULL DEFAULT 0;