-- Investor Hangout: follow-up, invitation, seat reservation and ticket fields on Registration,
-- call-feedback notes, and the new campaign audiences. Written to be safe to run twice.

-- AlterEnum
ALTER TYPE "CampaignAudience" ADD VALUE IF NOT EXISTS 'NOT_INVITED';
ALTER TYPE "CampaignAudience" ADD VALUE IF NOT EXISTS 'INVITED_NOT_RESERVED';
ALTER TYPE "CampaignAudience" ADD VALUE IF NOT EXISTS 'RESERVED';

-- AlterTable: phone and country are no longer required (an imported CSV may not have them)
ALTER TABLE "Registration" ALTER COLUMN "phone" SET DEFAULT '';
ALTER TABLE "Registration" ALTER COLUMN "country" SET DEFAULT '';

-- AlterTable: new participant fields
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "followUpStatus" TEXT NOT NULL DEFAULT 'NOT_CONTACTED';
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "callFeedback" TEXT;
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "extra" JSONB;
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "inviteSentAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "reservedAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "ticketCode" TEXT;
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "ticketSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Registration_ticketCode_key" ON "Registration"("ticketCode");

-- CreateTable
CREATE TABLE IF NOT EXISTS "FollowUpNote" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpNote_registrationId_createdAt_idx" ON "FollowUpNote"("registrationId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FollowUpNote" ADD CONSTRAINT "FollowUpNote_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
