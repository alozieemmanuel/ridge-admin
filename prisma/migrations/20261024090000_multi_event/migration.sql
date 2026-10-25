-- Multi-event: every event owns its contacts, settings, email templates, campaigns and activity log.
-- Everything that exists today becomes the first event, "Investor Hangout" (/event/investor-hangout).
-- Back up the database before running this.

CREATE TYPE "EventStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'ACTIVE',
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

CREATE TABLE "EventAdmin" (
    "eventId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAdmin_pkey" PRIMARY KEY ("eventId","adminId")
);
CREATE INDEX "EventAdmin_adminId_idx" ON "EventAdmin"("adminId");
ALTER TABLE "EventAdmin" ADD CONSTRAINT "EventAdmin_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAdmin" ADD CONSTRAINT "EventAdmin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The first event. Its name is taken from the current "Event name" setting when there is one.
INSERT INTO "Event" ("id", "slug", "name", "status", "modules", "updatedAt")
VALUES (
    'evt_investor_hangout',
    'investor-hangout',
    COALESCE(NULLIF((SELECT "value" FROM "Setting" WHERE "key" = 'programme_name' LIMIT 1), ''), 'Investor Hangout'),
    'ACTIVE',
    ARRAY['invitations', 'attendance', 'campaigns']::TEXT[],
    CURRENT_TIMESTAMP
);

-- Admins (not owners) keep their access to what they could already see.
INSERT INTO "EventAdmin" ("eventId", "adminId")
SELECT 'evt_investor_hangout', "id" FROM "Admin" WHERE "role" = 'ADMIN';

-- Contacts
ALTER TABLE "Registration" ADD COLUMN "eventId" TEXT;
UPDATE "Registration" SET "eventId" = 'evt_investor_hangout';
ALTER TABLE "Registration" ALTER COLUMN "eventId" SET NOT NULL;
DROP INDEX "Registration_email_key";
CREATE UNIQUE INDEX "Registration_eventId_email_key" ON "Registration"("eventId", "email");
CREATE INDEX "Registration_eventId_idx" ON "Registration"("eventId");
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campaigns
ALTER TABLE "Campaign" ADD COLUMN "eventId" TEXT;
UPDATE "Campaign" SET "eventId" = 'evt_investor_hangout';
ALTER TABLE "Campaign" ALTER COLUMN "eventId" SET NOT NULL;
CREATE INDEX "Campaign_eventId_idx" ON "Campaign"("eventId");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Settings: the key is now unique per event
ALTER TABLE "Setting" ADD COLUMN "eventId" TEXT;
UPDATE "Setting" SET "eventId" = 'evt_investor_hangout';
ALTER TABLE "Setting" ALTER COLUMN "eventId" SET NOT NULL;
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey";
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("eventId", "key");
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Email templates: the key is now unique per event
ALTER TABLE "EmailTemplate" ADD COLUMN "eventId" TEXT;
UPDATE "EmailTemplate" SET "eventId" = 'evt_investor_hangout';
ALTER TABLE "EmailTemplate" ALTER COLUMN "eventId" SET NOT NULL;
DROP INDEX "EmailTemplate_key_key";
CREATE UNIQUE INDEX "EmailTemplate_eventId_key_key" ON "EmailTemplate"("eventId", "key");
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activity log: event actions belong to the event, sign-ins and admin-account changes stay team-wide (eventId empty)
ALTER TABLE "AuditLog" ADD COLUMN "eventId" TEXT;
UPDATE "AuditLog" SET "eventId" = 'evt_investor_hangout'
WHERE "entityType" IN ('registration', 'campaign', 'data', 'template', 'seat')
   OR "action" LIKE 'participant.%' OR "action" LIKE 'participants.%' OR "action" LIKE 'contacts.%'
   OR "action" LIKE 'attendance.%' OR "action" LIKE 'settings.%' OR "action" LIKE 'template.%'
   OR "action" LIKE 'campaign.%' OR "action" LIKE 'registration.%';
CREATE INDEX "AuditLog_eventId_createdAt_idx" ON "AuditLog"("eventId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
