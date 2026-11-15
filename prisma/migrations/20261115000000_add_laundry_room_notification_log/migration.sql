-- CreateTable
CREATE TABLE "laundry_room_notification_log" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "location" "location" NOT NULL,
    "gender" "gender" NOT NULL,
    "type" "machine_type" NOT NULL,
    "subscribed_at" TIMESTAMP(3) NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laundry_room_notification_log_pkey" PRIMARY KEY ("uuid")
);

-- CreateIndex
CREATE INDEX "laundry_room_notification_log_user_uuid_idx" ON "laundry_room_notification_log"("user_uuid");

-- CreateIndex
CREATE INDEX "laundry_room_notification_log_notified_at_idx" ON "laundry_room_notification_log"("notified_at");

-- AddForeignKey
ALTER TABLE "laundry_room_notification_log" ADD CONSTRAINT "laundry_room_notification_log_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
