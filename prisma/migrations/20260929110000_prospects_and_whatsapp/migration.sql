-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WhatsAppDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProspectSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetTab" TEXT NOT NULL,
    "columnMap" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Prospect" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sheetRow" INTEGER,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "callRequested" TEXT,
    "callSchedule" TEXT,
    "callCompleted" BOOLEAN NOT NULL DEFAULT false,
    "callFeedback" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "confirmation" TEXT,
    "extra" JSONB,
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "writeBackError" TEXT,
    "registrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "contactName" TEXT,
    "registrationId" TEXT,
    "prospectId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppBroadcast" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateParams" JSONB,
    "previewText" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByName" TEXT,

    CONSTRAINT "WhatsAppBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WhatsAppDirection" NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "templateName" TEXT,
    "status" "WhatsAppStatus" NOT NULL,
    "errorMessage" TEXT,
    "waMessageId" TEXT,
    "sentByName" TEXT,
    "broadcastId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Prospect_registrationId_key" ON "Prospect"("registrationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Prospect_sourceId_externalId_key" ON "Prospect"("sourceId", "externalId");
CREATE INDEX IF NOT EXISTS "Prospect_sourceId_idx" ON "Prospect"("sourceId");
CREATE INDEX IF NOT EXISTS "Prospect_createdAt_idx" ON "Prospect"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppConversation_waId_key" ON "WhatsAppConversation"("waId");
CREATE INDEX IF NOT EXISTS "WhatsAppConversation_lastMessageAt_idx" ON "WhatsAppConversation"("lastMessageAt");
CREATE INDEX IF NOT EXISTS "WhatsAppBroadcast_sentAt_idx" ON "WhatsAppBroadcast"("sentAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_broadcastId_idx" ON "WhatsAppMessage"("broadcastId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProspectSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WhatsAppBroadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
