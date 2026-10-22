-- Follow-up log: each entry remembers the status chosen when it was written.
ALTER TABLE "FollowUpNote" ADD COLUMN IF NOT EXISTS "status" TEXT;

-- Feedback that came in with a CSV used to sit in its own box. Move it into the follow-up log as the first entry.
INSERT INTO "FollowUpNote" ("id", "registrationId", "body", "status", "authorName", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id"), r."id", r."callFeedback", r."followUpStatus", 'Imported from CSV', r."createdAt"
FROM "Registration" r
WHERE r."callFeedback" IS NOT NULL AND r."callFeedback" <> ''
  AND NOT EXISTS (SELECT 1 FROM "FollowUpNote" n WHERE n."registrationId" = r."id" AND n."body" = r."callFeedback");
UPDATE "Registration" SET "callFeedback" = NULL WHERE "callFeedback" IS NOT NULL;

-- Indexes that keep the counts and filters fast.
CREATE INDEX IF NOT EXISTS "Registration_followUpStatus_idx" ON "Registration"("followUpStatus");
CREATE INDEX IF NOT EXISTS "Registration_reservedAt_idx" ON "Registration"("reservedAt");
CREATE INDEX IF NOT EXISTS "Registration_inviteSentAt_idx" ON "Registration"("inviteSentAt");
CREATE INDEX IF NOT EXISTS "Registration_checkedInAt_idx" ON "Registration"("checkedInAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
