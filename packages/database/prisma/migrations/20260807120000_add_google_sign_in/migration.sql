-- Google sign-in.
--
-- `passwordHash` becomes nullable because an account created through Google
-- never picks a password. Existing rows all have one, so the drop is a no-op
-- for them.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "google_id" TEXT;

-- Unique so one Google account can never be linked to two ERP71 users. NULL is
-- distinct from NULL in Postgres, so every password-only account stays valid.
CREATE UNIQUE INDEX IF NOT EXISTS "User_google_id_key" ON "User"("google_id");
