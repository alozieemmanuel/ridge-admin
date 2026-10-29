-- Campaign sending that can be resumed without sending twice, and the last problem of each email sender.
ALTER TABLE "QueuedEmail" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "EmailSender" ADD COLUMN "lastError" TEXT;
ALTER TABLE "EmailSender" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
CREATE INDEX "QueuedEmail_campaignId_status_idx" ON "QueuedEmail"("campaignId", "status");
