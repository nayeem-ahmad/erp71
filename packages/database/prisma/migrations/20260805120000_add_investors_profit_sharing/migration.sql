-- Investors and monthly profit sharing.
--
-- An investor puts capital in and takes an agreed percentage of each month's
-- profit. That is equity, not debt, which is why this is its own set of tables
-- rather than a flavour of Loan.
--
-- Three postings, all through autoPostFromRules:
--   capital in      Dr Cash                          / Cr Investor Capital (equity)
--   monthly share   Dr Investor Profit Distribution  / Cr Investor Profit Payable
--   payout          Dr Investor Profit Payable       / Cr Cash
--
-- The accrual hits an equity-contra account rather than an expense on purpose.
-- An expense would land inside net profit, so re-running a month would read a
-- profit figure its own previous run had already reduced, and the number would
-- drift down on every recompute. Keeping the distribution in equity makes the
-- basis stable however many times a run is redone.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory (see
-- 20260804090000_add_referral_commission_reversal for the same note), so this
-- exists to keep the migration history honest rather than because it is the
-- mechanism that ships the change.
--
-- The new chart-of-accounts rows (Investor Profit Payable, Investor Capital,
-- Investor Profit Distribution) and their posting rules reach EXISTING tenants
-- via `npm run sync:accounting -w @erp71/database`, not from this file — a new
-- tenant gets them from bootstrap-accounting at signup. Until that script runs,
-- autoPostFromRules finds no rule and SKIPS, which posts nothing rather than
-- posting something wrong.

-- Permissions. Added to packages/shared-types first, which typechecks but does
-- not teach Postgres about them: UserStorePermission.permission is this enum, so
-- a grant cannot be written at all until the values exist.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_INVESTORS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_INVESTORS';

-- INVESTOR joins the subsidiary-ledger party types, so Investor Profit Payable
-- can be a control account whose balance breaks down per investor.
ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'INVESTOR';

ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'investor_contribution';
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'investor_withdrawal';
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'investor_profit_accrual';
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'investor_profit_payout';

-- CreateTable
CREATE TABLE "Investor" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "national_id" TEXT,
    "profit_share_pct" DECIMAL(5,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joined_on" DATE NOT NULL,
    "exited_on" DATE,
    "loss_carry_forward" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorCapitalTxn" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'CONTRIBUTION',
    "amount" DECIMAL(14,2) NOT NULL,
    "txn_date" DATE NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestorCapitalTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorProfitRun" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "scope_key" TEXT NOT NULL DEFAULT 'COMPANY',
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "profit_basis_amount" DECIMAL(14,2) NOT NULL,
    "basis_type" TEXT NOT NULL DEFAULT 'NET_PROFIT',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorProfitRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorProfitShare" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "share_pct_snapshot" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "loss_applied" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACCRUED',
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorProfitShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investor_tenant_id_status_idx" ON "Investor"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Investor_tenant_id_store_id_idx" ON "Investor"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "InvestorCapitalTxn_tenant_id_investor_id_idx" ON "InvestorCapitalTxn"("tenant_id", "investor_id");

-- CreateIndex
CREATE INDEX "InvestorCapitalTxn_tenant_id_txn_date_idx" ON "InvestorCapitalTxn"("tenant_id", "txn_date");

-- CreateIndex
-- One run per tenant per month per scope. Keyed on scope_key rather than the
-- nullable store_id: Postgres treats NULLs as distinct in a unique index, so a
-- (tenant, year, month, store_id) key would happily accept two company-wide runs
-- for the same month and accrue it twice.
CREATE UNIQUE INDEX "InvestorProfitRun_tenant_id_year_month_scope_key_key" ON "InvestorProfitRun"("tenant_id", "year", "month", "scope_key");

-- CreateIndex
CREATE INDEX "InvestorProfitRun_tenant_id_status_idx" ON "InvestorProfitRun"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorProfitShare_run_id_investor_id_key" ON "InvestorProfitShare"("run_id", "investor_id");

-- CreateIndex
CREATE INDEX "InvestorProfitShare_tenant_id_investor_id_idx" ON "InvestorProfitShare"("tenant_id", "investor_id");

-- CreateIndex
CREATE INDEX "InvestorProfitShare_tenant_id_status_idx" ON "InvestorProfitShare"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorCapitalTxn" ADD CONSTRAINT "InvestorCapitalTxn_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorCapitalTxn" ADD CONSTRAINT "InvestorCapitalTxn_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorProfitRun" ADD CONSTRAINT "InvestorProfitRun_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorProfitRun" ADD CONSTRAINT "InvestorProfitRun_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorProfitShare" ADD CONSTRAINT "InvestorProfitShare_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorProfitShare" ADD CONSTRAINT "InvestorProfitShare_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "InvestorProfitRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorProfitShare" ADD CONSTRAINT "InvestorProfitShare_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
