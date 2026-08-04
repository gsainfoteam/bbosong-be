/*
  Warnings:

  - You are about to drop the `machine_subscription` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[user_uuid,location,gender,type]` on the table `laundry_room_subscription` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('IDLE', 'WASH', 'RINSE', 'SPIN', 'DRY');

-- DropForeignKey
ALTER TABLE "machine_subscription" DROP CONSTRAINT "machine_subscription_machine_uuid_fkey";

-- DropForeignKey
ALTER TABLE "machine_subscription" DROP CONSTRAINT "machine_subscription_user_uuid_fkey";

-- AlterTable
ALTER TABLE "machine" ADD COLUMN     "status" "MachineStatus" NOT NULL DEFAULT 'IDLE';

-- AlterTable
ALTER TABLE "using_machine" ADD COLUMN     "notify_on_completion" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "user_uuid" DROP NOT NULL,
ALTER COLUMN "duration_minutes" SET DEFAULT 0;

-- DropTable
DROP TABLE "machine_subscription";

-- CreateIndex
CREATE UNIQUE INDEX "laundry_room_subscription_user_uuid_location_gender_type_key" ON "laundry_room_subscription"("user_uuid", "location", "gender", "type");
