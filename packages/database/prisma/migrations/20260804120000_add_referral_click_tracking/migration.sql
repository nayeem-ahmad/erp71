-- Referral click tracking.
--
-- Partners could see conversions but not traffic, so a code that was shared
-- widely and converted badly looked identical to one nobody ever clicked.
--
-- Holds no IP address and no visitor identifier by design: a partner's marketing
-- reach does not justify storing anything that identifies the person who clicked.
-- `referrer` and `user_agent` are what make the number interpretable (bot traffic
-- vs a real campaign) and are truncated by the application on write.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory, so this file keeps the history
-- honest rather than being the mechanism that ships the change.

CREATE TABLE IF NOT EXISTS "ReferralClick" (
    "id"          TEXT NOT NULL,
    "referee_id"  TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "referrer"    TEXT,
    "user_agent"  TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReferralClick_referee_id_occurred_at_idx"
    ON "ReferralClick"("referee_id", "occurred_at");

ALTER TABLE "ReferralClick"
    ADD CONSTRAINT "ReferralClick_referee_id_fkey"
    FOREIGN KEY ("referee_id") REFERENCES "Referee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
