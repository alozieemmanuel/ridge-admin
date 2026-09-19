-- AlterEnum
ALTER TYPE "EmailSource" ADD VALUE IF NOT EXISTS 'CAMPAIGN';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CampaignAudience" AS ENUM ('ALL', 'EARLY_BIRD', 'LATE', 'NOT_PAID', 'PARTIAL', 'PAID', 'CHECKED_IN', 'NOT_CHECKED_IN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "CampaignAudience" NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByName" TEXT,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Campaign_sentAt_idx" ON "Campaign"("sentAt");
