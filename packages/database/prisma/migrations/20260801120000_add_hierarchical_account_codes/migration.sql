-- Hierarchical chart-of-accounts codes: <type><group> / +<subgroup> / +<account>.
--
-- DDL ONLY. The backfill that fills these columns lives in
-- prisma/backfill-account-codes.ts and runs from the backend's boot chain,
-- because production reconciles its schema with `prisma db push` and never runs
-- migrations (see apps/backend/Dockerfile). Putting the backfill here would mean
-- it only ever ran on the path production does not use, and restating the code
-- allocator in PL/pgSQL would give it a second implementation to drift from.
--
-- The columns therefore default to '' rather than being NOT NULL outright: a
-- required column with no default cannot be added to a populated table, which
-- fails `db push` and takes the whole boot chain -- and the site -- down.
-- Phase B tightens these to UNIQUE once every environment is backfilled;
-- see TODO.md.

ALTER TABLE "account_groups" ADD COLUMN "code" VARCHAR(2) NOT NULL DEFAULT '';
ALTER TABLE "account_subgroups" ADD COLUMN "code" VARCHAR(4) NOT NULL DEFAULT '';

-- accounts.code already existed as a nullable free-text column holding the old
-- flat numbers (1010, 5020 …). Those are preserved into legacy_code by the
-- backfill, which is also what rewrites code itself.
ALTER TABLE "accounts" ADD COLUMN "legacy_code" TEXT;
-- Left nullable on purpose: this column already existed with NULL rows, and
-- `db push` refuses to make an existing column required whether or not it has a
-- default. Phase B tightens it once the backfill has filled every row.
ALTER TABLE "accounts" ALTER COLUMN "code" TYPE VARCHAR(6);

CREATE INDEX "accounts_tenant_id_code_idx" ON "accounts"("tenant_id", "code");
