-- CreateTable "payment_methods"
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable "sales_settings"
CREATE TABLE "sales_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "paper_size" TEXT NOT NULL DEFAULT 'A4',
    "reference_number_format" TEXT NOT NULL DEFAULT 'YYMM-#',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_settings_pkey" PRIMARY KEY ("id")
);

-- Add column to Sale table for reference_number
ALTER TABLE "Sale" ADD COLUMN "reference_number" TEXT;

-- Add column to PaymentRecord table for account_id
ALTER TABLE "PaymentRecord" ADD COLUMN "account_id" TEXT;

-- CreateIndex for payment_methods
CREATE UNIQUE INDEX "payment_methods_tenant_id_name_key" ON "payment_methods"("tenant_id", "name");
CREATE INDEX "payment_methods_tenant_id_type_is_active_idx" ON "payment_methods"("tenant_id", "type", "is_active");

-- CreateIndex for sales_settings
CREATE UNIQUE INDEX "sales_settings_tenant_id_key" ON "sales_settings"("tenant_id");

-- CreateIndex for Sale reference_number
CREATE UNIQUE INDEX "Sale_tenant_id_reference_number_key" ON "Sale"("tenant_id", "reference_number");

-- CreateIndex for PaymentRecord account_id
CREATE INDEX "PaymentRecord_account_id_idx" ON "PaymentRecord"("account_id");

-- AddForeignKey for payment_methods
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for sales_settings
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for PaymentRecord account_id
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
