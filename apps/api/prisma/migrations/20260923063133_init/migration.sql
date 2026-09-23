-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('explorer', 'holder', 'builder');

-- CreateTable
CREATE TABLE "Model" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "menuName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerColor" TEXT NOT NULL,
    "bestFor" TEXT NOT NULL,
    "speed" INTEGER NOT NULL,
    "minTier" "Tier" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "openrouterId" TEXT NOT NULL,
    "openrouterFamily" TEXT NOT NULL,
    "upstreamName" TEXT NOT NULL,
    "promptPrice" DECIMAL(18,12) NOT NULL,
    "completionPrice" DECIMAL(18,12) NOT NULL,
    "contextLength" INTEGER,
    "lastVerifiedAt" TIMESTAMP(3),
    "missingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tierOverride" "Tier",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "walletId" TEXT,
    "walletAddress" TEXT,
    "modelId" TEXT NOT NULL,
    "openrouterId" TEXT NOT NULL,
    "generationId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "ttftMs" INTEGER,
    "status" INTEGER NOT NULL,
    "errorCode" TEXT,
    "stream" BOOLEAN NOT NULL,
    "ipHash" TEXT,
    "compareId" TEXT,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompareRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelA" TEXT NOT NULL,
    "modelB" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "completedA" BOOLEAN NOT NULL DEFAULT false,
    "completedB" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CompareRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCheck" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "missing" TEXT[],
    "details" JSONB NOT NULL,

    CONSTRAINT "ModelCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_walletId_idx" ON "ApiKey"("walletId");

-- CreateIndex
CREATE INDEX "UsageLog_createdAt_idx" ON "UsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_walletId_createdAt_idx" ON "UsageLog"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_apiKeyId_createdAt_idx" ON "UsageLog"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_compareId_idx" ON "UsageLog"("compareId");

-- CreateIndex
CREATE INDEX "CompareRun_createdAt_idx" ON "CompareRun"("createdAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
