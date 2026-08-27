-- Per-session refresh tokens, so a short-lived access JWT can be renewed
-- silently instead of dropping the user at the login screen mid-task.
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_token_hash_key" ON "RefreshToken"("token_hash");
CREATE INDEX "RefreshToken_user_id_idx" ON "RefreshToken"("user_id");
CREATE INDEX "RefreshToken_expires_at_idx" ON "RefreshToken"("expires_at");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
