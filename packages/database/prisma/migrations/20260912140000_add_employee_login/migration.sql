-- Employee login: a password an admin set, which the holder must replace.
--
-- `EmployeeLoginService` provisions a `User` for an employee who has no ERP
-- account, with a generated password HR reads off the screen and passes on.
-- That password is known to at least two people from the moment it exists, so
-- it is good for exactly one sign-in: while this flag is true the session may
-- authenticate and change its own password and nothing else.
--
-- Additive only, and defaulted, so every existing row keeps the behaviour it
-- has today: nobody is suddenly asked to change a password they chose
-- themselves.
--
-- Production reconciles its schema with `prisma db push` on container start and
-- never runs this directory (see 20260804170000_add_hr_permissions for the same
-- note), so this exists to keep the migration history honest rather than
-- because it is the mechanism that ships the change. `db push` emits exactly
-- this statement for the diff: no DROP, no ALTER COLUMN, no backfill.

ALTER TABLE "User" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
