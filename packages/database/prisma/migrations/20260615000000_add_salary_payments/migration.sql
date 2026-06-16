-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "basic_salary" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "pay_period" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'CASH',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_tenant_id_employee_id_pay_period_key" ON "SalaryPayment"("tenant_id", "employee_id", "pay_period");

-- CreateIndex
CREATE INDEX "SalaryPayment_tenant_id_payment_date_idx" ON "SalaryPayment"("tenant_id", "payment_date");

-- CreateIndex
CREATE INDEX "SalaryPayment_tenant_id_employee_id_idx" ON "SalaryPayment"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
