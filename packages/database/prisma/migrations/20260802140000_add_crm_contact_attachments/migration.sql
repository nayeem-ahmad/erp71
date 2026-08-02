-- Keeps the photographed business card a contact was read from, so the AI
-- extraction can be checked against the card itself rather than taken on trust.
--
-- Additive only: a new table with no change to `crm_contacts`, so this is safe
-- under the production boot chain's `prisma db push --accept-data-loss`.
CREATE TABLE "crm_contact_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "storage_key" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'BUSINESS_CARD',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contact_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_contact_attachments_tenant_id_contact_id_created_at_idx"
    ON "crm_contact_attachments"("tenant_id", "contact_id", "created_at");

ALTER TABLE "crm_contact_attachments"
    ADD CONSTRAINT "crm_contact_attachments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_contact_attachments"
    ADD CONSTRAINT "crm_contact_attachments_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_contact_attachments"
    ADD CONSTRAINT "crm_contact_attachments_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
