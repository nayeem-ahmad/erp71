-- Multi-role tenant membership + seeded per-module role templates.
--
-- Production applies schema with `prisma db push` (see apps/backend/Dockerfile),
-- not with these files; this migration exists so a local `prisma migrate` history
-- stays in step with the schema. The data backfill lives in
-- `prisma/sync-tenant-role-templates.ts`, which runs in the container start chain.

-- Which TENANT_ROLE_TEMPLATES entry a role was seeded from.
ALTER TABLE "TenantRole" ADD COLUMN "template_key" TEXT;

CREATE UNIQUE INDEX "TenantRole_tenant_id_template_key_key"
  ON "TenantRole"("tenant_id", "template_key");

-- Every role a member holds. Their access is the union of all of them.
CREATE TABLE "TenantUserRole" (
    "id" TEXT NOT NULL,
    "tenant_user_id" TEXT NOT NULL,
    "tenant_role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantUserRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantUserRole_tenant_user_id_tenant_role_id_key"
  ON "TenantUserRole"("tenant_user_id", "tenant_role_id");
CREATE INDEX "TenantUserRole_tenant_role_id_idx" ON "TenantUserRole"("tenant_role_id");

ALTER TABLE "TenantUserRole" ADD CONSTRAINT "TenantUserRole_tenant_user_id_fkey"
  FOREIGN KEY ("tenant_user_id") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantUserRole" ADD CONSTRAINT "TenantUserRole_tenant_role_id_fkey"
  FOREIGN KEY ("tenant_role_id") REFERENCES "TenantRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every role an invitee will hold once they accept.
CREATE TABLE "UserInvitationRole" (
    "id" TEXT NOT NULL,
    "invitation_id" TEXT NOT NULL,
    "tenant_role_id" TEXT NOT NULL,

    CONSTRAINT "UserInvitationRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInvitationRole_invitation_id_tenant_role_id_key"
  ON "UserInvitationRole"("invitation_id", "tenant_role_id");
CREATE INDEX "UserInvitationRole_tenant_role_id_idx" ON "UserInvitationRole"("tenant_role_id");

ALTER TABLE "UserInvitationRole" ADD CONSTRAINT "UserInvitationRole_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "UserInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitationRole" ADD CONSTRAINT "UserInvitationRole_tenant_role_id_fkey"
  FOREIGN KEY ("tenant_role_id") REFERENCES "TenantRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing members keep exactly the access they have: their single role becomes
-- the first entry of their role set.
INSERT INTO "TenantUserRole" ("id", "tenant_user_id", "tenant_role_id", "assigned_at")
SELECT gen_random_uuid(), "id", "tenant_role_id", CURRENT_TIMESTAMP
FROM "TenantUser"
WHERE "tenant_role_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "UserInvitationRole" ("id", "invitation_id", "tenant_role_id")
SELECT gen_random_uuid(), "id", "tenant_role_id"
FROM "UserInvitation"
WHERE "accepted_at" IS NULL
ON CONFLICT DO NOTHING;
