-- A task can now move to another project from its card, and the feed records
-- it as PROJECT_CHANGED. Additive only: no existing row carries it.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see apps/backend/Dockerfile), so this file is the record; the guard keeps it
-- a no-op on a database `db push` has already reached.
ALTER TYPE "ProjectTaskActivityType" ADD VALUE IF NOT EXISTS 'PROJECT_CHANGED';
