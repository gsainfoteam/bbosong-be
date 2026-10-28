ALTER TABLE "machine"
ADD COLUMN "thinq_device_id" TEXT,
ADD COLUMN "thinq_current_state" TEXT,
ADD COLUMN "thinq_remaining_minutes" INTEGER,
ADD COLUMN "thinq_updated_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "machine_thinq_device_id_key" ON "machine"("thinq_device_id");
