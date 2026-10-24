BEGIN;

-- Generated with Prisma migrate diff; partial unique indexes follow the existing
-- using_machine migration convention because they are managed in SQL.
ALTER TABLE "machine" ADD COLUMN "deleted_at" TIMESTAMP(3);

DROP INDEX "machine_mac_address_key";
DROP INDEX "machine_location_gender_type_index_key";

CREATE UNIQUE INDEX "machine_mac_address_key"
ON "machine" ("mac_address") WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "machine_location_gender_type_index_key"
ON "machine" ("location", "gender", "type", "index") WHERE "deleted_at" IS NULL;

-- Keep machine_short_code_key global: an old QR code must never resolve to a replacement.

COMMIT;
