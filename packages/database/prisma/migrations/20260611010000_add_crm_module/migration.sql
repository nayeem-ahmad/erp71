-- CRM Module: extend Customer, add CustomerInteraction, CrmTask, CustomerCreditTransaction

-- Extend Customer with CRM fields
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "due_balance"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "credit_enabled"    BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_contacted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "preferred_channel" TEXT          NOT NULL DEFAULT 'PHONE',
  ADD COLUMN IF NOT EXISTS "birthday"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "anniversary"       TIMESTAMP(3);

-- CustomerInteraction
CREATE TABLE IF NOT EXISTS "CustomerInteraction" (
  "id"          TEXT         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "store_id"    TEXT,
  "customer_id" TEXT         NOT NULL,
  "type"        TEXT         NOT NULL,
  "direction"   TEXT         NOT NULL DEFAULT 'OUTBOUND',
  "summary"     TEXT         NOT NULL,
  "outcome"     TEXT,
  "created_by"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerInteraction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerInteraction_tenant_id_customer_id_idx"
  ON "CustomerInteraction"("tenant_id", "customer_id");

CREATE INDEX IF NOT EXISTS "CustomerInteraction_tenant_id_created_at_idx"
  ON "CustomerInteraction"("tenant_id", "created_at");

ALTER TABLE "CustomerInteraction"
  ADD CONSTRAINT "CustomerInteraction_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerInteraction_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerInteraction_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CrmTask
CREATE TABLE IF NOT EXISTS "CrmTask" (
  "id"           TEXT         NOT NULL,
  "tenant_id"    TEXT         NOT NULL,
  "store_id"     TEXT,
  "customer_id"  TEXT         NOT NULL,
  "type"         TEXT         NOT NULL,
  "title"        TEXT         NOT NULL,
  "due_at"       TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "assigned_to"  TEXT,
  "created_by"   TEXT,
  "notes"        TEXT,
  "status"       TEXT         NOT NULL DEFAULT 'PENDING',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CrmTask_tenant_id_status_due_at_idx"
  ON "CrmTask"("tenant_id", "status", "due_at");

CREATE INDEX IF NOT EXISTS "CrmTask_tenant_id_customer_id_idx"
  ON "CrmTask"("tenant_id", "customer_id");

ALTER TABLE "CrmTask"
  ADD CONSTRAINT "CrmTask_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmTask_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmTask_assigned_to_fkey"
    FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmTask_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CustomerCreditTransaction
CREATE TABLE IF NOT EXISTS "CustomerCreditTransaction" (
  "id"             TEXT         NOT NULL,
  "tenant_id"      TEXT         NOT NULL,
  "customer_id"    TEXT         NOT NULL,
  "type"           TEXT         NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "balance_after"  DECIMAL(12,2) NOT NULL,
  "reference_type" TEXT,
  "reference_id"   TEXT,
  "notes"          TEXT,
  "created_by"     TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerCreditTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerCreditTransaction_tenant_id_customer_id_idx"
  ON "CustomerCreditTransaction"("tenant_id", "customer_id");

CREATE INDEX IF NOT EXISTS "CustomerCreditTransaction_tenant_id_created_at_idx"
  ON "CustomerCreditTransaction"("tenant_id", "created_at");

ALTER TABLE "CustomerCreditTransaction"
  ADD CONSTRAINT "CustomerCreditTransaction_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerCreditTransaction_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerCreditTransaction_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
