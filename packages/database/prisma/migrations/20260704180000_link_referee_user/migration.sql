-- Link referees to login accounts (optional one-to-one with User).
ALTER TABLE "Referee" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Referee_user_id_key" ON "Referee"("user_id");

-- AddForeignKey
ALTER TABLE "Referee" ADD CONSTRAINT "Referee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;