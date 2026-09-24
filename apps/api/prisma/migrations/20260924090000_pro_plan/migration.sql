-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "proUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProPayment" (
    "txHash" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "usdMicro" BIGINT NOT NULL,
    "days" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProPayment_pkey" PRIMARY KEY ("txHash")
);

-- CreateIndex
CREATE INDEX "ProPayment_walletId_idx" ON "ProPayment"("walletId");

-- AddForeignKey
ALTER TABLE "ProPayment" ADD CONSTRAINT "ProPayment_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

