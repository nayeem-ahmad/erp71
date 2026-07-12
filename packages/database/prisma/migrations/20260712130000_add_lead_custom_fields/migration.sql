-- Reusable per-tenant custom fields, wired to leads first.
CREATE TYPE "CustomFieldEntity" AS ENUM ('LEAD');

CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDefinition_tenant_id_entity_key_key" ON "CustomFieldDefinition"("tenant_id", "entity", "key");
CREATE INDEX "CustomFieldDefinition_tenant_id_entity_idx" ON "CustomFieldDefinition"("tenant_id", "entity");

ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD COLUMN "custom_fields" JSONB;
