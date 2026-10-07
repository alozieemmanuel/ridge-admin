-- 1. Registration categories ("What best describes you?" on the register page)
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The register page sends the answers at the top of the notes ("Describes self as: A; B").
-- Fill the new column from that line for everyone who has already registered.
UPDATE "Registration"
SET "categories" = ARRAY(
  SELECT btrim(x)
  FROM unnest(string_to_array(substring("notes" from 'Describes self as: ([^\n]*)'), '; ')) AS x
  WHERE btrim(x) <> ''
)
WHERE "notes" LIKE 'Describes self as: %'
  AND cardinality("categories") = 0;

-- 2. Optional category filter on campaigns and WhatsApp broadcasts
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "WhatsAppBroadcast" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- 3. Seat unveiling. Only unveiled seats are visible on the public seat page.
ALTER TABLE "Seat" ADD COLUMN IF NOT EXISTS "released" BOOLEAN NOT NULL DEFAULT false;

-- Seats that are already booked stay visible to their holders.
UPDATE "Seat" SET "released" = true WHERE "registrationId" IS NOT NULL;
