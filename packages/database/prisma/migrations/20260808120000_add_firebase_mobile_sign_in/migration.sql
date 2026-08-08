-- Mobile-number sign-in via Firebase phone auth.
--
-- All three changes are additive on an existing table: two new nullable columns
-- and one non-unique index, so no backfill is needed and no existing row is
-- invalidated.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firebase_uid" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mobile_verified_at" TIMESTAMP(3);

-- Unique so one Firebase identity can never be linked to two ERP71 users. NULL
-- is distinct from NULL in Postgres, so every account that has never used
-- mobile sign-in stays valid.
CREATE UNIQUE INDEX IF NOT EXISTS "User_firebase_uid_key" ON "User"("firebase_uid");

-- Sign-in matches an account by its E.164 number. Not unique: the same number
-- may already appear on several accounts, and sign-in refuses those rather than
-- the schema rejecting the data that is already there.
CREATE INDEX IF NOT EXISTS "User_mobile_idx" ON "User"("mobile");
