-- Per-tenant sender identity for outbound email / WhatsApp.
-- No row means "use the platform sender", which is what every tenant does today.

CREATE TABLE IF NOT EXISTS "TenantMessagingIdentity" (
  "id"                       TEXT         NOT NULL,
  "tenant_id"                TEXT         NOT NULL,
  "email_enabled"            BOOLEAN      NOT NULL DEFAULT false,
  "email_from"               TEXT,
  "email_from_name"          TEXT,
  "email_reply_to"           TEXT,
  "whatsapp_enabled"         BOOLEAN      NOT NULL DEFAULT false,
  "whatsapp_phone_number_id" TEXT,
  "whatsapp_access_token"    TEXT,
  "whatsapp_api_version"     TEXT,
  "notes"                    TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  "updated_by"               TEXT,

  CONSTRAINT "TenantMessagingIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantMessagingIdentity_tenant_id_key"
  ON "TenantMessagingIdentity"("tenant_id");

ALTER TABLE "TenantMessagingIdentity"
  ADD CONSTRAINT "TenantMessagingIdentity_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
