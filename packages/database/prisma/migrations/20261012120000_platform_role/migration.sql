-- Support engineers: a restricted seat in the platform admin console. Nullable,
-- so every existing user stays exactly as they were.

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPPORT_ENGINEER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "platform_role" "PlatformRole";
