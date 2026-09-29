-- AlterTable
ALTER TABLE "machine" ADD COLUMN     "is_commissioned" BOOLEAN,
ADD COLUMN     "mac_address" TEXT,
ADD COLUMN     "matter_payload" TEXT;
