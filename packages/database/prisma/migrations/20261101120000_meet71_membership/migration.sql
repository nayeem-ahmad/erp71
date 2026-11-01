-- Meet71 membership, allow/deny lists, SSO codes, and standing rooms.
-- Additive only: CREATE TYPE / TABLE / INDEX and one FK. No DROP, no ALTER COLUMN.
-- Production reconciles schema with `prisma db push` on container start and
-- never runs this directory; this keeps the migration history honest.

-- CreateEnum
CREATE TYPE "Meet71AllowKind" AS ENUM ('EMAIL', 'DOMAIN');

-- CreateTable
CREATE TABLE "Meet71AllowEntry" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "kind" "Meet71AllowKind" NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meet71AllowEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meet71Member" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "can_create_room" BOOLEAN NOT NULL DEFAULT false,
    "invite_quota" INTEGER NOT NULL DEFAULT 0,
    "invites_used" INTEGER NOT NULL DEFAULT 0,
    "invited_by_email" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meet71Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meet71DenyEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meet71DenyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meet71SsoCode" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "return_url" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meet71SsoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meet71Room" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meet71Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meet71AllowEntry_pattern_key" ON "Meet71AllowEntry"("pattern");

-- CreateIndex
CREATE INDEX "Meet71AllowEntry_kind_idx" ON "Meet71AllowEntry"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Meet71Member_email_key" ON "Meet71Member"("email");

-- CreateIndex
CREATE INDEX "Meet71Member_user_id_idx" ON "Meet71Member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Meet71DenyEntry_email_key" ON "Meet71DenyEntry"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Meet71SsoCode_code_hash_key" ON "Meet71SsoCode"("code_hash");

-- CreateIndex
CREATE INDEX "Meet71SsoCode_expires_at_idx" ON "Meet71SsoCode"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "Meet71Room_code_key" ON "Meet71Room"("code");

-- CreateIndex
CREATE INDEX "Meet71Room_created_by_email_idx" ON "Meet71Room"("created_by_email");

-- AddForeignKey
ALTER TABLE "Meet71Member" ADD CONSTRAINT "Meet71Member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
