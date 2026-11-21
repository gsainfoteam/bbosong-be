-- Android apps that render Live Update notifications from FCM data-only messages.
-- Existing rows keep receiving the regular alert push.
ALTER TABLE "user_push_subscription"
ADD COLUMN "supports_live_update" BOOLEAN NOT NULL DEFAULT false;
