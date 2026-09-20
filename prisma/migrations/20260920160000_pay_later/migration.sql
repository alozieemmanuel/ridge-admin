-- AlterTable
ALTER TABLE "Registration" ADD COLUMN "payLaterDate" TIMESTAMP(3),
ADD COLUMN "payLaterReminderAt" TIMESTAMP(3);