-- Tests module: question bank and one attempt per participant.
CREATE TABLE "TestQuestion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestAttempt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "paper" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "total" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TestQuestion_eventId_idx" ON "TestQuestion"("eventId");
CREATE UNIQUE INDEX "TestAttempt_registrationId_key" ON "TestAttempt"("registrationId");
CREATE INDEX "TestAttempt_eventId_idx" ON "TestAttempt"("eventId");

ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
