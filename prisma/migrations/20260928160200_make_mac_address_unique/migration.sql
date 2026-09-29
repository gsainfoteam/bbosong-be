DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM machine
    WHERE mac_address IS NOT NULL
    GROUP BY mac_address
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null mac_address values exist; resolve them before creating machine_mac_address_key';
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "machine_mac_address_key" ON "machine"("mac_address");
