-- Investor Hangout: a contact can be added by hand without an email address. Written to be safe to run twice.

-- AlterTable: which events allow it
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "emailOptional" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Event" SET "emailOptional" = true WHERE "slug" = 'investor-hangout';

-- A contact without an email is stored with email = '', so the unique index must only cover real addresses.
-- The index keeps its name, so Prisma's eventId_email lookups keep working for contacts that have an email.
DROP INDEX IF EXISTS "Registration_eventId_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Registration_eventId_email_key" ON "Registration"("eventId", "email") WHERE "email" <> '';
