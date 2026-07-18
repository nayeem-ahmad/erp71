-- Payroll accrual: post an employee's monthly salary as an expense + payable
-- (Dr Salary & Wages / Cr Salary Payable) so it reaches the P&L and each employee
-- gets a payable ledger, distinct from the cash payment that settles it.

-- AlterEnum
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'salary_accrual';

-- CreateTable
CREATE TABLE "SalaryAccrual" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "pay_period" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "voucher_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAccrual_tenant_id_employee_id_pay_period_key" ON "SalaryAccrual"("tenant_id", "employee_id", "pay_period");

-- CreateIndex
CREATE INDEX "SalaryAccrual_tenant_id_pay_period_idx" ON "SalaryAccrual"("tenant_id", "pay_period");

-- CreateIndex
CREATE INDEX "SalaryAccrual_tenant_id_employee_id_idx" ON "SalaryAccrual"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
