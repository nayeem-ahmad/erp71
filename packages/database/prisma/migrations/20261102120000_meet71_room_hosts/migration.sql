-- CreateTable
CREATE TABLE "Meet71RoomHost" (
    "id" TEXT NOT NULL,
    "room_code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meet71RoomHost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meet71RoomHost_room_code_email_key" ON "Meet71RoomHost"("room_code", "email");

-- CreateIndex
CREATE INDEX "Meet71RoomHost_email_idx" ON "Meet71RoomHost"("email");

-- AddForeignKey
ALTER TABLE "Meet71RoomHost" ADD CONSTRAINT "Meet71RoomHost_room_code_fkey" FOREIGN KEY ("room_code") REFERENCES "Meet71Room"("code") ON DELETE CASCADE ON UPDATE CASCADE;
