-- Event brand and wording, plus uploaded logo files.
ALTER TABLE "Event"
    ADD COLUMN "type" TEXT NOT NULL DEFAULT 'free',
    ADD COLUMN "brandName" TEXT,
    ADD COLUMN "color" TEXT,
    ADD COLUMN "logoUrl" TEXT,
    ADD COLUMN "logoDarkUrl" TEXT,
    ADD COLUMN "terms" JSONB,
    ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos';

CREATE TABLE "EventAsset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventAsset_eventId_idx" ON "EventAsset"("eventId");
ALTER TABLE "EventAsset" ADD CONSTRAINT "EventAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
