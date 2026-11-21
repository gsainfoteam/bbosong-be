-- CreateEnum
CREATE TYPE "live_activity_environment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateTable
CREATE TABLE "live_activity_token" (
    "uuid" UUID NOT NULL,
    "user_uuid" UUID NOT NULL,
    "using_machine_uuid" UUID NOT NULL,
    "push_token" TEXT NOT NULL,
    "environment" "live_activity_environment" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_activity_token_pkey" PRIMARY KEY ("uuid")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_activity_token_push_token_key" ON "live_activity_token"("push_token");

-- CreateIndex
CREATE INDEX "live_activity_token_using_machine_uuid_idx" ON "live_activity_token"("using_machine_uuid");

-- CreateIndex
CREATE INDEX "live_activity_token_user_uuid_idx" ON "live_activity_token"("user_uuid");

-- CreateIndex
CREATE INDEX "live_activity_token_updated_at_idx" ON "live_activity_token"("updated_at");

-- AddForeignKey
ALTER TABLE "live_activity_token" ADD CONSTRAINT "live_activity_token_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "user"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_activity_token" ADD CONSTRAINT "live_activity_token_using_machine_uuid_fkey" FOREIGN KEY ("using_machine_uuid") REFERENCES "using_machine"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
