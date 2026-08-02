-- Backfill APPROVE_VOUCHER onto existing tenants' Accountant role.
--
-- NOTE: production never runs this. The backend container reconciles its schema
-- with `prisma db push` on boot and applies no migrations, so the backfill that
-- actually reaches production lives in prisma/sync-approve-voucher-permission.ts
-- (invoked by sync-accounting.ts, which is in the container CMD chain). This file
-- keeps local `prisma migrate deploy` in step; the two are equivalent.
--
-- Separate from the migration that adds the enum value because Postgres will not
-- let a newly added enum value be USED in the same transaction that added it.
--
-- Scope is deliberately narrow: only the system "Accountant" role, matching
-- ROLE_DEFAULT_PERMISSIONS in packages/shared-types. Managers and cashiers are
-- left alone — letting whoever entered a voucher also approve it would defeat
-- the point. Owners bypass permission checks entirely and need no grant.
--
-- The permission is inert until an owner turns approval on in accounting
-- settings, so this grants no new capability on its own.

INSERT INTO "TenantRolePermission" ("id", "tenant_role_id", "permission")
SELECT gen_random_uuid(), r."id", 'APPROVE_VOUCHER'::"StorePermission"
FROM "TenantRole" r
WHERE r."is_system" = true
  AND r."name" = 'Accountant'
ON CONFLICT ("tenant_role_id", "permission") DO NOTHING;

-- Materialize it onto members already carrying that role, the same way
-- syncMemberPermissionsFromRole would on a re-assignment.
INSERT INTO "UserStorePermission" ("id", "user_id", "store_id", "tenant_id", "permission", "granted_by")
SELECT gen_random_uuid(), tu."user_id", usa."store_id", tu."tenant_id", 'APPROVE_VOUCHER'::"StorePermission", tu."user_id"
FROM "TenantUser" tu
JOIN "TenantRole" r ON r."id" = tu."tenant_role_id" AND r."is_system" = true AND r."name" = 'Accountant'
JOIN "UserStoreAccess" usa ON usa."user_id" = tu."user_id" AND usa."tenant_id" = tu."tenant_id"
ON CONFLICT ("user_id", "store_id", "permission") DO NOTHING;
