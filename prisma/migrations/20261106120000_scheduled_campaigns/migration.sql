-- Campaigns that go out at a chosen time on their own.
CREATE TABLE "ScheduledCampaign" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "CampaignAudience" NOT NULL,
    "category" TEXT,
    "ctaLabel" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "resultMessage" TEXT,
    "campaignId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduledCampaign_status_runAt_idx" ON "ScheduledCampaign"("status", "runAt");
CREATE INDEX "ScheduledCampaign_eventId_idx" ON "ScheduledCampaign"("eventId");
ALTER TABLE "ScheduledCampaign" ADD CONSTRAINT "ScheduledCampaign_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
