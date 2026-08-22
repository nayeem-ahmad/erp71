-- Team chat: private staff-to-staff conversations inside a workspace.
--
-- Distinct from support_threads/support_messages, which are one tenant talking
-- to the platform. These conversations are readable only by their participants,
-- and that rule is enforced by chat_participants rather than by tenant scoping
-- alone — an OWNER is not implicitly a member of a DM they are not in.

-- The permission goes in first: UserStorePermission.permission is this enum, so
-- a grant cannot be written until the value exists, and Postgres will not let a
-- value added here be used later in the same transaction.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'USE_TEAM_CHAT';

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'dm',
    "title" TEXT,
    -- Sorted "userA:userB" for DMs, NULL for groups. See the unique index below.
    "dm_key" TEXT,
    "created_by" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Denormalised from the newest message so the polled conversation list can
    -- sort and preview without a correlated subquery per row.
    "last_message_at" TIMESTAMP(3),
    "last_message_preview" TEXT,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_participants" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    -- One write per conversation-open, instead of a read row per message seen.
    "last_read_at" TIMESTAMP(3),
    "muted_until" TIMESTAMP(3),
    -- Set instead of deleting, so a departed member's messages still resolve to
    -- a name. A row with left_at set reads nothing.
    "left_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "edited_at" TIMESTAMP(3),
    -- Soft delete leaves a tombstone in the thread; body is blanked at delete
    -- time so a careless select cannot resurface it.
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER,
    -- Cloudinary's handle. Without it the row can be deleted while the file
    -- stays, billed forever.
    "storage_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Partial-by-nature: Postgres treats NULLs as distinct, so this constrains DMs
-- (one row per tenant per sorted user pair) while leaving groups unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_tenant_id_dm_key_key" ON "chat_conversations"("tenant_id", "dm_key");
CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_id_last_message_at_idx" ON "chat_conversations"("tenant_id", "last_message_at");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_participants_conversation_id_user_id_key" ON "chat_participants"("conversation_id", "user_id");
-- Drives "my conversations", which every open client polls.
CREATE INDEX IF NOT EXISTS "chat_participants_user_id_left_at_idx" ON "chat_participants"("user_id", "left_at");
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");
-- Unread counting is "since last_read_at, not sent by me" — this covers it.
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_sender_id_created_at_idx" ON "chat_messages"("conversation_id", "sender_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_attachments_message_id_idx" ON "chat_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
