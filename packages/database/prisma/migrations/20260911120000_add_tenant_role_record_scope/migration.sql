-- Per-role record scope: how much of a module's data a role can see.
--
-- `ALL` is every record the role's permissions reach — what every role does
-- today. `OWN` narrows reads to the records the member is on: their own tasks
-- and their own hour logs, so a tenant admin can staff one module with someone
-- who may work but may not read the rest of the team's rows.
--
-- The column defaults to `ALL` and every existing row takes that default, so
-- nothing a workspace already has changes on the day this lands. Narrowing is
-- always an explicit act on a role.
--
-- Why a column and not a `StorePermission`: a member's effective access is the
-- *union* of the roles they hold (`role-sync.util.ts`), and a union can add but
-- never subtract — a restriction expressed as a permission would survive into
-- every other role they were given. The scope is resolved widest-wins instead:
-- a member is narrow only when every role they hold says `OWN`.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see TODO.md), so both changes arrive on deploy either way; this file is the
-- record. Safe under `db push` too: the column is nullable-free only because it
-- carries a default, which is exactly the shape `db push` can add to a
-- populated table.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantRecordScope') THEN
        CREATE TYPE "TenantRecordScope" AS ENUM ('ALL', 'OWN');
    END IF;
END $$;

ALTER TABLE "TenantRole"
    ADD COLUMN IF NOT EXISTS "record_scope" "TenantRecordScope" NOT NULL DEFAULT 'ALL';
