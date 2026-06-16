-- Align the StorePermission enum with the shared-types permission matrix.
-- These loan permissions exist in ROLE_DEFAULT_PERMISSIONS, so without them the
-- user-provisioning flow fails when seeding an owner/manager/accountant.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_LOANS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_LOANS';

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "counterparty" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'PAYABLE',
    "principal" DECIMAL(14,2) NOT NULL,
    "interest_rate" DECIMAL(5,2),
    "start_date" DATE NOT NULL,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reference" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'CASH',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Loan_tenant_id_status_idx" ON "Loan"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Loan_tenant_id_direction_idx" ON "Loan"("tenant_id", "direction");

-- CreateIndex
CREATE INDEX "LoanPayment_tenant_id_loan_id_idx" ON "LoanPayment"("tenant_id", "loan_id");

-- CreateIndex
CREATE INDEX "LoanPayment_tenant_id_payment_date_idx" ON "LoanPayment"("tenant_id", "payment_date");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
