-- Per-store override of which letterhead a document type prints. No row means
-- that branch follows the tenant's company assignment.

CREATE TABLE "print_template_store_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_template_store_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "print_template_store_assignments_tenant_id_store_id_doc_type_key" ON "print_template_store_assignments"("tenant_id", "store_id", "doc_type");
CREATE INDEX "print_template_store_assignments_tenant_id_store_id_idx" ON "print_template_store_assignments"("tenant_id", "store_id");
CREATE INDEX "print_template_store_assignments_template_id_idx" ON "print_template_store_assignments"("template_id");

ALTER TABLE "print_template_store_assignments"
    ADD CONSTRAINT "print_template_store_assignments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_template_store_assignments"
    ADD CONSTRAINT "print_template_store_assignments_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_template_store_assignments"
    ADD CONSTRAINT "print_template_store_assignments_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "print_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
