-- HR store permissions, for the HR > Overview dashboard.
--
-- `VIEW_HR` gates the employee directory and attendance; `VIEW_PAYROLL` gates
-- the salary figures on top of it. Both are read-only.
--
-- These were added to packages/shared-types first, which typechecks but does
-- *not* teach Postgres about them: `UserStorePermission.permission` is this
-- enum, so a query filtering on 'VIEW_PAYROLL' fails at runtime and a grant
-- cannot be written at all. This file closes that gap.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory (see
-- 20260804090000_add_referral_commission_reversal for the same note), so this
-- exists to keep the migration history honest rather than because it is the
-- mechanism that ships the change. `db push` emits exactly these two statements
-- for this schema diff: no DROP, no ALTER COLUMN, no backfill.
--
-- Nobody holds either permission after this runs. OWNER bypasses the check in
-- StorePermissionGuard, so owners see the whole HR dashboard immediately;
-- everyone else sees it once an admin grants VIEW_HR from Team & Permissions.

ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_HR';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_PAYROLL';
