-- CreateTable
CREATE TABLE "TenantNavLayout" (
    "tenant_id" TEXT NOT NULL,
    "layout" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "TenantNavLayout_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "TenantNavLayout" ADD CONSTRAINT "TenantNavLayout_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;