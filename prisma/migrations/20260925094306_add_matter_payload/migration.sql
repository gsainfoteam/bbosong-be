-- AlterTable
DELETE FROM "machine";
ALTER TABLE "machine" ADD COLUMN     "is_commissioned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mac_address" TEXT,
ADD COLUMN     "matter_payload" TEXT NOT NULL;