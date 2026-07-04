-- Add optional mobile number fields to platform users
ALTER TABLE "User" ADD COLUMN "mobile_country_code" TEXT NOT NULL DEFAULT 'BD';
ALTER TABLE "User" ADD COLUMN "mobile" TEXT;

CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile") WHERE "mobile" IS NOT NULL;