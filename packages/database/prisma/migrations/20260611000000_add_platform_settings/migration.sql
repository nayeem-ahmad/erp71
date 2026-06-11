-- CreateTable: platform_settings for storing global SMS, Email, and payment gateway configuration

CREATE TABLE "platform_settings" (
    "id" SERIAL NOT NULL,
    "group" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_group_key_key" ON "platform_settings"("group", "key");
