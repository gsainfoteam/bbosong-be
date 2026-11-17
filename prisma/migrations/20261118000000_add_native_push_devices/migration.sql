-- CreateEnum
CREATE TYPE "push_platform" AS ENUM ('WEB', 'IOS', 'ANDROID');

-- Existing rows are Web Push subscriptions.
ALTER TABLE "user_push_subscription"
ADD COLUMN "platform" "push_platform" NOT NULL DEFAULT 'WEB',
ADD COLUMN "fcm_token" TEXT,
ALTER COLUMN "endpoint" DROP NOT NULL,
ALTER COLUMN "p256dh" DROP NOT NULL,
ALTER COLUMN "auth" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "user_push_subscription_fcm_token_key" ON "user_push_subscription"("fcm_token");

-- A row is either a complete Web Push subscription or a native FCM device.
ALTER TABLE "user_push_subscription"
ADD CONSTRAINT "user_push_subscription_credentials_check" CHECK (
  (
    "platform" = 'WEB'
    AND "endpoint" IS NOT NULL
    AND "p256dh" IS NOT NULL
    AND "auth" IS NOT NULL
    AND "fcm_token" IS NULL
  )
  OR (
    "platform" IN ('IOS', 'ANDROID')
    AND "fcm_token" IS NOT NULL
    AND "endpoint" IS NULL
    AND "p256dh" IS NULL
    AND "auth" IS NULL
  )
);
