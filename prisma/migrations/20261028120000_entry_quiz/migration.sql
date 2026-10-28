-- Entry quiz: a short quiz before a guest can reserve a seat.
ALTER TABLE "TestQuestion" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "Registration" ADD COLUMN "quizPaper" JSONB;
ALTER TABLE "Registration" ADD COLUMN "quizScore" INTEGER;
ALTER TABLE "Registration" ADD COLUMN "quizTotal" INTEGER;
ALTER TABLE "Registration" ADD COLUMN "quizAt" TIMESTAMP(3);
