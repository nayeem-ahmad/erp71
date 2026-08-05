-- Keep the DB-side permission enum in lockstep with packages/shared-types.
--
-- Production reconciles its schema with `prisma db push` on container start
-- and never runs this directory (see the `add_short_links` migration), so this
-- file keeps local `prisma migrate deploy` in step; the value actually reaches
-- production via `db push` reading the updated schema.prisma, and reaches
-- existing tenants' Manager role via `sync-role-permissions.ts`'s
-- `short-links` backfill group.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_SHORT_LINKS';
