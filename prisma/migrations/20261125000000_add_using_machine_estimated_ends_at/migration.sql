-- User-entered estimated finish time of a session (washers have no ThinQ timer).
ALTER TABLE "using_machine" ADD COLUMN "estimated_ends_at" TIMESTAMP(3);
