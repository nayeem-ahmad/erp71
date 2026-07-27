-- CreateIndex
CREATE INDEX "LeadConversation_tenant_id_type_created_at_idx" ON "LeadConversation"("tenant_id", "type", "created_at");
