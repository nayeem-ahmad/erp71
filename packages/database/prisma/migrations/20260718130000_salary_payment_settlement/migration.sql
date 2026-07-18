-- Salary payments settle the accrued payable (Dr Salary Payable / Cr <mode>),
-- and a pay period may now be paid in several instalments/advances.

-- AlterEnum
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'salary_payment';

-- Drop the one-payment-per-(employee, period) constraint. The accrued Salary
-- Payable balance is the source of truth; a period can have many settling rows.
DROP INDEX IF EXISTS "SalaryPayment_tenant_id_employee_id_pay_period_key";

-- Replace it with a plain index for the same lookups.
CREATE INDEX IF NOT EXISTS "SalaryPayment_tenant_id_employee_id_pay_period_idx" ON "SalaryPayment"("tenant_id", "employee_id", "pay_period");
