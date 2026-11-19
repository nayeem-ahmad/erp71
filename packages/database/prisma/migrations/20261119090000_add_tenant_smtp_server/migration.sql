-- A shop's own outgoing mail server (SMTP). No row means the shop's mail goes
-- out through the platform provider, which is what every tenant does today.

CREATE TABLE IF NOT EXISTS "TenantSmtpServer" (
  "id"            TEXT         NOT NULL,
  "tenant_id"     TEXT         NOT NULL,
  "enabled"       BOOLEAN      NOT NULL DEFAULT false,
  "host"          TEXT,
  "port"          INTEGER      NOT NULL DEFAULT 587,
  "security"      TEXT         NOT NULL DEFAULT 'starttls',
  "username"      TEXT,
  "password"      TEXT,
  "from_email"    TEXT,
  "from_name"     TEXT,
  "reply_to"      TEXT,
  "verified_at"   TIMESTAMP(3),
  "last_error"    TEXT,
  "last_error_at" TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "updated_by"    TEXT,

  CONSTRAINT "TenantSmtpServer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantSmtpServer_tenant_id_key"
  ON "TenantSmtpServer"("tenant_id");

ALTER TABLE "TenantSmtpServer"
  ADD CONSTRAINT "TenantSmtpServer_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
