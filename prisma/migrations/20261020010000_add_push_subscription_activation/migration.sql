-- Existing subscriptions have no recorded activation timestamp.
ALTER TABLE "user_push_subscription"
ADD COLUMN "last_activated_at" TIMESTAMP(3);
