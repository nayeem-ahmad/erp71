-- Reusable CRM message templates: the "payment reminder" WhatsApp, the "thanks
-- for visiting" SMS, the standing call script. Tenant-owned, managed from
-- CRM → Setup → Message Templates, and picked from the Log activity / Schedule
-- activity dialogs.
--
-- No backfill: there is nothing in the database that was a template before this,
-- and seeding sample text into every tenant would put words nobody wrote in
-- front of a customer.

-- CreateTable
CREATE TABLE "CrmMessageTemplate" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- LOG | SCHEDULE | BOTH — which of the two composers offers it.
    "usage" TEXT NOT NULL DEFAULT 'BOTH',
    "channel_id" TEXT,
    "purpose_id" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One name per tenant, so the picker never shows two identical-looking rows.
CREATE UNIQUE INDEX "CrmMessageTemplate_tenant_id_name_key" ON "CrmMessageTemplate"("tenant_id", "name");

-- CreateIndex
-- Serves the picker, which reads one tenant's active templates in display order
-- every time the Log / Schedule dialog opens.
CREATE INDEX "CrmMessageTemplate_tenant_id_is_active_sort_order_idx" ON "CrmMessageTemplate"("tenant_id", "is_active", "sort_order");

-- CreateIndex
-- Serves the per-channel template counts on the CRM Setup screen.
CREATE INDEX "CrmMessageTemplate_tenant_id_channel_id_idx" ON "CrmMessageTemplate"("tenant_id", "channel_id");

-- AddForeignKey
ALTER TABLE "CrmMessageTemplate" ADD CONSTRAINT "CrmMessageTemplate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, not RESTRICT: retiring a channel from CRM Setup already moves the
-- activities that used it, and refusing that delete because a template happens
-- to mention the channel would be a surprising place to be stopped. The template
-- lives on, offered for every channel instead of one.
ALTER TABLE "CrmMessageTemplate" ADD CONSTRAINT "CrmMessageTemplate_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "ConversationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMessageTemplate" ADD CONSTRAINT "CrmMessageTemplate_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "CrmActivityPurpose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMessageTemplate" ADD CONSTRAINT "CrmMessageTemplate_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
