-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_PAID', 'PARTIAL', 'PAID');

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "paymentNote" TEXT,
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_PAID',
ADD COLUMN     "seatInviteSentAt" TIMESTAMP(3);
