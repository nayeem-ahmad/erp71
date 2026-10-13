-- Files and voice notes sent with a support ticket or feedback.
CREATE TABLE IF NOT EXISTS "support_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'file',
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT,
    "resourceType" TEXT NOT NULL DEFAULT 'image',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_attachments_messageId_idx" ON "support_attachments"("messageId");
CREATE INDEX IF NOT EXISTS "support_attachments_tenantId_idx" ON "support_attachments"("tenantId");

DO $$ BEGIN
    ALTER TABLE "support_attachments"
        ADD CONSTRAINT "support_attachments_messageId_fkey"
        FOREIGN KEY ("messageId") REFERENCES "support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
