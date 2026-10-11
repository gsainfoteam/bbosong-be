ALTER TABLE "machine" ADD COLUMN "short_code" TEXT;

-- Extract the last path segment, ignoring query strings, fragments and trailing slashes.
UPDATE "machine"
SET "short_code" = substring(
  rtrim(regexp_replace("short_url", '[?#].*$', ''), '/') FROM '/([^/]+)$'
)
WHERE "short_url" IS NOT NULL;

-- Reject duplicate codes rather than resolving a QR code to an arbitrary machine.
CREATE UNIQUE INDEX "machine_short_code_key" ON "machine"("short_code");
