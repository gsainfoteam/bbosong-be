ALTER TABLE "machine"
ADD COLUMN "thinq_device_id" TEXT,
ADD COLUMN "thinq_current_state" TEXT,
ADD COLUMN "thinq_remaining_minutes" INTEGER,
ADD COLUMN "thinq_updated_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "machine_thinq_device_id_key"
ON "machine"("thinq_device_id") WHERE "deleted_at" IS NULL;

-- ThinQ dryers are identified by deviceId only; they never carry a Matter MAC.
UPDATE "machine"
SET "mac_address" = NULL
WHERE "thinq_device_id" IS NOT NULL
  AND "mac_address" IS NOT NULL;

ALTER TABLE "machine"
ADD CONSTRAINT "machine_thinq_device_without_mac"
CHECK ("thinq_device_id" IS NULL OR "mac_address" IS NULL);
