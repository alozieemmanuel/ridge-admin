-- AlterTable
ALTER TABLE "EmailEvent" ADD COLUMN     "campaignId" TEXT;

-- CreateIndex
CREATE INDEX "EmailEvent_campaignId_idx" ON "EmailEvent"("campaignId");

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
