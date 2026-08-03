-- Tenant-editable communication channels for CRM conversations, replacing the
-- hardcoded LeadConversationType list.
--
-- `LeadConversation.type` is kept and keeps holding the channel `code`: every
-- filter, sort and groupBy on that table reads it, and the existing
-- (tenant_id, type, created_at) index serves those directly.

-- CreateTable
CREATE TABLE "ConversationChannel" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationChannel_tenant_id_is_active_sort_order_idx" ON "ConversationChannel"("tenant_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationChannel_tenant_id_code_key" ON "ConversationChannel"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationChannel_tenant_id_name_key" ON "ConversationChannel"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "ConversationChannel" ADD CONSTRAINT "ConversationChannel_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "LeadConversation" ADD COLUMN "channel_id" TEXT;

-- CreateIndex
CREATE INDEX "LeadConversation_tenant_id_channel_id_idx" ON "LeadConversation"("tenant_id", "channel_id");

-- AddForeignKey
ALTER TABLE "LeadConversation" ADD CONSTRAINT "LeadConversation_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "ConversationChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the shipped defaults for every existing tenant. New tenants get these from
-- seedDefaultLeadTaxonomy() at signup.
INSERT INTO "ConversationChannel" ("id", "tenant_id", "code", "name", "icon", "sort_order", "is_system", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."id", d."code", d."name", d."icon", d."sort_order", true, true, NOW(), NOW()
FROM "Tenant" t
CROSS JOIN (VALUES
    ('CALL', 'Call', '📞', 1),
    ('SMS', 'SMS', '💬', 2),
    ('WHATSAPP', 'WhatsApp', '🟢', 3),
    ('EMAIL', 'Email', '📧', 4),
    ('VISIT', 'Visit', '🏪', 5),
    ('ONLINE_MEETING', 'Online Meeting', '💻', 6),
    ('NOTE', 'Note', '📝', 7)
) AS d("code", "name", "icon", "sort_order")
ON CONFLICT DO NOTHING;

-- Any `type` value actually present on a conversation but not covered above gets its
-- own row, so the backfill below can never orphan a conversation. Named after the code
-- itself because there is no label to recover — a tenant can rename it afterwards.
-- Untargeted DO NOTHING: a stray value could collide on `name` as well as `code`, and a
-- migration that aborts on a duplicate label would block the whole release.
INSERT INTO "ConversationChannel" ("id", "tenant_id", "code", "name", "icon", "sort_order", "is_system", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, c."tenant_id", c."type", c."type", NULL, 90, false, true, NOW(), NOW()
FROM (SELECT DISTINCT "tenant_id", "type" FROM "LeadConversation" WHERE "type" <> '') c
ON CONFLICT DO NOTHING;

-- Backfill the FK by joining on the code already stored in `type`.
UPDATE "LeadConversation" lc
SET "channel_id" = ch."id"
FROM "ConversationChannel" ch
WHERE ch."tenant_id" = lc."tenant_id"
  AND ch."code" = lc."type"
  AND lc."channel_id" IS NULL;
