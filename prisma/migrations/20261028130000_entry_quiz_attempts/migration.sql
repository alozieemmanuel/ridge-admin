-- Entry quiz: count the attempts so a guest gets a limited number of tries.
ALTER TABLE "Registration" ADD COLUMN "quizAttempts" INTEGER NOT NULL DEFAULT 0;
