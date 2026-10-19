BEGIN;

ALTER TABLE "using_machine" ADD COLUMN "ended_at" TIMESTAMP(3);

-- Existing idle-machine records may be placeholders created during machine
-- registration. Preserve them, but do not treat them as running sessions.
-- Their actual completion time was not recorded; this is a migration cutoff.
UPDATE "using_machine" AS usage
SET "ended_at" = GREATEST(usage."started_at", CURRENT_TIMESTAMP)
FROM "machine"
WHERE usage."machine_uuid" = "machine"."uuid"
  AND "machine"."status" = 'IDLE';

DROP INDEX "using_machine_machine_uuid_key";
DROP INDEX "using_machine_user_uuid_idx";

-- NULL completion time denotes an open session. Closed sessions can accumulate.
CREATE UNIQUE INDEX "using_machine_one_active_session_per_machine"
ON "using_machine" ("machine_uuid") WHERE "ended_at" IS NULL;

CREATE INDEX "using_machine_machine_uuid_started_at_idx"
ON "using_machine" ("machine_uuid", "started_at");
CREATE INDEX "using_machine_user_uuid_ended_at_started_at_idx"
ON "using_machine" ("user_uuid", "ended_at", "started_at");

ALTER TABLE "using_machine" DROP CONSTRAINT "using_machine_machine_uuid_fkey";
ALTER TABLE "using_machine" ADD CONSTRAINT "using_machine_machine_uuid_fkey"
FOREIGN KEY ("machine_uuid") REFERENCES "machine"("uuid")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "using_machine" ADD CONSTRAINT "using_machine_valid_period"
CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

COMMIT;
