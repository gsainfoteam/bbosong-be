-- CreateEnum
CREATE TYPE "consent_type" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('USER');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "location" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "machine_type" AS ENUM ('WASHER', 'DRYER');

-- CreateTable
CREATE TABLE "user" (
    "uuid" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "student_number" TEXT NOT NULL,
    "gender" "gender" NOT NULL,
    "role" "role" NOT NULL DEFAULT 'USER',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "user_refresh_token" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expired_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_refresh_token_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "user_consent" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "consent_type" "consent_type" NOT NULL,
    "version" TEXT NOT NULL,
    "agreed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consent_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "uuid" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "user_uuid" UUID,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "machine" (
    "uuid" UUID NOT NULL,
    "type" "machine_type" NOT NULL,
    "location" "location" NOT NULL,
    "gender" "gender" NOT NULL,
    "index" INTEGER NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "pos_x" INTEGER,
    "pos_y" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "using_machine" (
    "uuid" UUID NOT NULL,
    "machine_uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_minutes" INTEGER NOT NULL,

    CONSTRAINT "using_machine_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "machine_power" (
    "uuid" UUID NOT NULL,
    "machine_uuid" UUID NOT NULL,
    "power" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_power_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "user_push_subscription" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_push_subscription_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "laundry_room_subscription" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "location" "location" NOT NULL,
    "gender" "gender" NOT NULL,
    "type" "machine_type" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laundry_room_subscription_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "machine_subscription" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "machine_uuid" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_subscription_pkey" PRIMARY KEY ("uuid")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_student_number_key" ON "user"("student_number");

-- CreateIndex
CREATE UNIQUE INDEX "user_refresh_token_refresh_token_key" ON "user_refresh_token"("refresh_token");

-- CreateIndex
CREATE INDEX "user_refresh_token_user_uuid_session_id_idx" ON "user_refresh_token"("user_uuid", "session_id");

-- CreateIndex
CREATE INDEX "user_consent_user_uuid_consent_type_idx" ON "user_consent"("user_uuid", "consent_type");

-- CreateIndex
CREATE INDEX "audit_log_performed_at_idx" ON "audit_log"("performed_at");

-- CreateIndex
CREATE INDEX "audit_log_user_uuid_idx" ON "audit_log"("user_uuid");

-- CreateIndex
CREATE INDEX "machine_location_gender_idx" ON "machine"("location", "gender");

-- CreateIndex
CREATE UNIQUE INDEX "machine_location_gender_type_index_key" ON "machine"("location", "gender", "type", "index");

-- CreateIndex
CREATE UNIQUE INDEX "using_machine_machine_uuid_key" ON "using_machine"("machine_uuid");

-- CreateIndex
CREATE INDEX "using_machine_user_uuid_idx" ON "using_machine"("user_uuid");

-- CreateIndex
CREATE INDEX "machine_power_machine_uuid_idx" ON "machine_power"("machine_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "user_push_subscription_endpoint_key" ON "user_push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "user_push_subscription_user_uuid_idx" ON "user_push_subscription"("user_uuid");

-- CreateIndex
CREATE INDEX "laundry_room_subscription_user_uuid_idx" ON "laundry_room_subscription"("user_uuid");

-- CreateIndex
CREATE INDEX "laundry_room_subscription_location_gender_type_idx" ON "laundry_room_subscription"("location", "gender", "type");

-- CreateIndex
CREATE INDEX "machine_subscription_user_uuid_idx" ON "machine_subscription"("user_uuid");

-- CreateIndex
CREATE INDEX "machine_subscription_machine_uuid_idx" ON "machine_subscription"("machine_uuid");

-- AddForeignKey
ALTER TABLE "user_refresh_token" ADD CONSTRAINT "user_refresh_token_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consent" ADD CONSTRAINT "user_consent_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "using_machine" ADD CONSTRAINT "using_machine_machine_uuid_fkey" FOREIGN KEY ("machine_uuid") REFERENCES "machine"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "using_machine" ADD CONSTRAINT "using_machine_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_power" ADD CONSTRAINT "machine_power_machine_uuid_fkey" FOREIGN KEY ("machine_uuid") REFERENCES "machine"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_subscription" ADD CONSTRAINT "user_push_subscription_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laundry_room_subscription" ADD CONSTRAINT "laundry_room_subscription_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_subscription" ADD CONSTRAINT "machine_subscription_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_subscription" ADD CONSTRAINT "machine_subscription_machine_uuid_fkey" FOREIGN KEY ("machine_uuid") REFERENCES "machine"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
