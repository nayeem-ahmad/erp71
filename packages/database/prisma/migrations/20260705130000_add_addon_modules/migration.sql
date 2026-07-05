-- CreateTable: catalog of optional paid modules (e.g. Manufacturing, Advanced Accounting)
CREATE TABLE "AddonModule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "monthly_price" DECIMAL(12,2) NOT NULL,
    "yearly_price" DECIMAL(12,2),
    "features_json" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AddonModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: a tenant's purchase of a single add-on module
CREATE TABLE "TenantAddonSubscription" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "addon_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider_name" TEXT,
    "provider_subscription_ref" TEXT,

    CONSTRAINT "TenantAddonSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AddonModule_code_key" ON "AddonModule"("code");

-- CreateIndex
CREATE INDEX "AddonModule_is_active_sort_order_idx" ON "AddonModule"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAddonSubscription_tenant_id_addon_id_key" ON "TenantAddonSubscription"("tenant_id", "addon_id");

-- CreateIndex
CREATE INDEX "TenantAddonSubscription_addon_id_status_idx" ON "TenantAddonSubscription"("addon_id", "status");

-- AddForeignKey
ALTER TABLE "TenantAddonSubscription" ADD CONSTRAINT "TenantAddonSubscription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAddonSubscription" ADD CONSTRAINT "TenantAddonSubscription_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "AddonModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
