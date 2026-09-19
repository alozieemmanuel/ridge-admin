-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "paymentUpdatedAt" TIMESTAMP(3);
