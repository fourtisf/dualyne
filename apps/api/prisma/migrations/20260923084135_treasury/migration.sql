-- CreateTable
CREATE TABLE "TreasuryTransfer" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "amountMicroUsd" BIGINT NOT NULL,

    CONSTRAINT "TreasuryTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasurySnapshot" (
    "id" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balanceMicroUsd" BIGINT NOT NULL,

    CONSTRAINT "TreasurySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainCursor" (
    "name" TEXT NOT NULL,
    "block" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "TreasuryTransfer_timestamp_idx" ON "TreasuryTransfer"("timestamp");

-- CreateIndex
CREATE INDEX "TreasurySnapshot_takenAt_idx" ON "TreasurySnapshot"("takenAt");
