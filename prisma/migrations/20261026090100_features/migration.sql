-- Data source and website-form key per event
ALTER TABLE "Event" ADD COLUMN "dataSource" TEXT NOT NULL DEFAULT 'sheet';
ALTER TABLE "Event" ADD COLUMN "intakeToken" TEXT;
CREATE UNIQUE INDEX "Event_intakeToken_key" ON "Event"("intakeToken");

-- WhatsApp chats and broadcasts belong to an event
ALTER TABLE "WhatsAppConversation" ADD COLUMN "eventId" TEXT;
CREATE INDEX "WhatsAppConversation_eventId_idx" ON "WhatsAppConversation"("eventId");
ALTER TABLE "WhatsAppBroadcast" ADD COLUMN "eventId" TEXT;
CREATE INDEX "WhatsAppBroadcast_eventId_idx" ON "WhatsAppBroadcast"("eventId");

-- Email sender pool
CREATE TABLE "EmailSender" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailSender_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailSender_kind_key" ON "EmailSender"("kind");

-- Campaign emails waiting for tomorrow's allowance
CREATE TABLE "QueuedEmail" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "QueuedEmail_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QueuedEmail_status_createdAt_idx" ON "QueuedEmail"("status", "createdAt");
CREATE INDEX "QueuedEmail_campaignId_idx" ON "QueuedEmail"("campaignId");
ALTER TABLE "QueuedEmail" ADD CONSTRAINT "QueuedEmail_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QueuedEmail" ADD CONSTRAINT "QueuedEmail_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
