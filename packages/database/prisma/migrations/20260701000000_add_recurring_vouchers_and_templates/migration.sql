-- CreateTable
CREATE TABLE "recurring_vouchers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "voucher_type" TEXT NOT NULL DEFAULT 'journal',
    "frequency" TEXT NOT NULL,
    "next_due_date" TIMESTAMP(3) NOT NULL,
    "last_run_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_voucher_lines" (
    "id" TEXT NOT NULL,
    "recurring_voucher_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "comment" TEXT,

    CONSTRAINT "recurring_voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "voucher_type" TEXT NOT NULL DEFAULT 'journal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_template_lines" (
    "id" TEXT NOT NULL,
    "voucher_template_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "comment" TEXT,

    CONSTRAINT "voucher_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_vouchers_tenant_id_idx" ON "recurring_vouchers"("tenant_id");

-- CreateIndex
CREATE INDEX "recurring_vouchers_tenant_id_next_due_date_is_active_idx" ON "recurring_vouchers"("tenant_id", "next_due_date", "is_active");

-- CreateIndex
CREATE INDEX "recurring_voucher_lines_recurring_voucher_id_idx" ON "recurring_voucher_lines"("recurring_voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_templates_tenant_id_name_key" ON "voucher_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "voucher_templates_tenant_id_idx" ON "voucher_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "voucher_templates_tenant_id_voucher_type_idx" ON "voucher_templates"("tenant_id", "voucher_type");

-- CreateIndex
CREATE INDEX "voucher_template_lines_voucher_template_id_idx" ON "voucher_template_lines"("voucher_template_id");

-- AddForeignKey
ALTER TABLE "recurring_vouchers" ADD CONSTRAINT "recurring_vouchers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_voucher_lines" ADD CONSTRAINT "recurring_voucher_lines_recurring_voucher_id_fkey" FOREIGN KEY ("recurring_voucher_id") REFERENCES "recurring_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_voucher_lines" ADD CONSTRAINT "recurring_voucher_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_templates" ADD CONSTRAINT "voucher_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_template_lines" ADD CONSTRAINT "voucher_template_lines_voucher_template_id_fkey" FOREIGN KEY ("voucher_template_id") REFERENCES "voucher_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_template_lines" ADD CONSTRAINT "voucher_template_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
