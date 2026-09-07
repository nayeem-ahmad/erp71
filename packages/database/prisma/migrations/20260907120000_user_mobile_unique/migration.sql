-- Restore uniqueness on User.mobile so a number identifies exactly one account,
-- reversing 20260710120000_drop_user_mobile_unique. Sign-in by mobile number
-- needs the number to name one person; a second business belongs on the same
-- account as a second workspace, not behind a second login.
--
-- The column is already populated and duplicates were legal until now, so the
-- collisions have to go first or CREATE UNIQUE INDEX fails. Production never
-- runs this file — it applies schema with `prisma db push` — which is why the
-- same clearing is done by prisma/sync-user-mobile-unique.ts, wired ahead of
-- db push in apps/backend/Dockerfile. This block keeps a developer's own
-- database in step with what that script does on the server.
--
-- Nothing is deleted. For each repeated number one account keeps it — the one
-- that proved it by SMS, else the oldest — and the rest have the number and its
-- now-meaningless verification timestamp cleared.
UPDATE "User" AS u
SET "mobile" = NULL, "mobile_verified_at" = NULL
WHERE u."mobile" IS NOT NULL
  AND u."id" <> (
    SELECT k."id" FROM "User" AS k
    WHERE k."mobile" = u."mobile"
    ORDER BY (k."mobile_verified_at" IS NULL), k."created_at"
    LIMIT 1
  );

-- Partial, matching the index this restores: NULL means "no number on file",
-- which any number of accounts may be.
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile") WHERE "mobile" IS NOT NULL;
