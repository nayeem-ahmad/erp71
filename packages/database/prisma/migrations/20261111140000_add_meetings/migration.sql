-- Meeting minutes. Scope: docs/meeting-minutes-plan.md
-- Production applies schema via `prisma db push`; this file is the history.

CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');
CREATE TYPE "MeetingType" AS ENUM ('MANAGEMENT', 'STAFF', 'CLIENT', 'SUPPLIER', 'OTHER');
CREATE TYPE "MeetingAttendeeRole" AS ENUM ('CHAIR', 'MINUTE_TAKER', 'MEMBER', 'GUEST');
CREATE TYPE "MeetingActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "MeetingActionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_MEETINGS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_ALL_MEETINGS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_MEETINGS';

ALTER TYPE "ShortLinkEntity" ADD VALUE IF NOT EXISTS 'MEETING';

CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "meeting_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'OTHER',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "venue" TEXT,
    "summary" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    "organizer_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "finalized_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "share_token" TEXT,
    "share_token_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meetings_share_token_key" ON "meetings"("share_token");
CREATE UNIQUE INDEX "meetings_tenant_id_meeting_number_key" ON "meetings"("tenant_id", "meeting_number");
CREATE INDEX "meetings_tenant_id_starts_at_idx" ON "meetings"("tenant_id", "starts_at");
CREATE INDEX "meetings_tenant_id_status_idx" ON "meetings"("tenant_id", "status");

CREATE TABLE "meeting_attendees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "organization" TEXT,
    "role" "MeetingAttendeeRole" NOT NULL DEFAULT 'MEMBER',
    "attended" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_attendees_tenant_id_user_id_idx" ON "meeting_attendees"("tenant_id", "user_id");
CREATE INDEX "meeting_attendees_meeting_id_idx" ON "meeting_attendees"("meeting_id");

CREATE TABLE "meeting_discussions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "decision" TEXT,

    CONSTRAINT "meeting_discussions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_discussions_meeting_id_position_idx" ON "meeting_discussions"("meeting_id", "position");

CREATE TABLE "meeting_action_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "discussion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "assignee_user_id" TEXT,
    "assignee_name" TEXT NOT NULL,
    "assignee_email" TEXT,
    "assignee_org" TEXT,
    "due_date" DATE NOT NULL,
    "priority" "MeetingActionPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MeetingActionStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "completion_note" TEXT,
    "assigned_notified_at" TIMESTAMP(3),
    "due_soon_notified_at" TIMESTAMP(3),
    "last_overdue_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_action_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_action_items_discussion_id_position_idx" ON "meeting_action_items"("discussion_id", "position");
CREATE INDEX "meeting_action_items_tenant_id_status_due_date_idx" ON "meeting_action_items"("tenant_id", "status", "due_date");
CREATE INDEX "meeting_action_items_tenant_id_assignee_user_id_status_idx" ON "meeting_action_items"("tenant_id", "assignee_user_id", "status");
CREATE INDEX "meeting_action_items_meeting_id_idx" ON "meeting_action_items"("meeting_id");

CREATE TABLE "meeting_action_people" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action_item_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "organization" TEXT,

    CONSTRAINT "meeting_action_people_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_action_people_tenant_id_user_id_idx" ON "meeting_action_people"("tenant_id", "user_id");
CREATE INDEX "meeting_action_people_action_item_id_position_idx" ON "meeting_action_people"("action_item_id", "position");

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_discussions" ADD CONSTRAINT "meeting_discussions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_discussions" ADD CONSTRAINT "meeting_discussions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_discussion_id_fkey" FOREIGN KEY ("discussion_id") REFERENCES "meeting_discussions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_action_people" ADD CONSTRAINT "meeting_action_people_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_action_people" ADD CONSTRAINT "meeting_action_people_action_item_id_fkey" FOREIGN KEY ("action_item_id") REFERENCES "meeting_action_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_action_people" ADD CONSTRAINT "meeting_action_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
