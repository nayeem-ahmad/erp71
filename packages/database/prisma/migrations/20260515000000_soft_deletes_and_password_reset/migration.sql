-- AlterTable: add soft-delete column to Product
ALTER TABLE "Product" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- AlterTable: add soft-delete column to Customer
ALTER TABLE "Customer" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- AlterTable: add soft-delete column to Supplier
ALTER TABLE "Supplier" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateTable: password reset tokens
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_hash_key" ON "PasswordResetToken"("token_hash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_user_id_idx" ON "PasswordResetToken"("user_id");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
