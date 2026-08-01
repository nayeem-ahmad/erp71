-- Tenant-designed print headers (letterheads) for printed documents.

CREATE TABLE "print_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "doc_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "print_templates_tenant_id_idx" ON "print_templates"("tenant_id");

ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
