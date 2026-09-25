-- Accounts beyond wallets: email and Google sign-in, referrals, and opt-in chat sync.
ALTER TABLE "Wallet" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "Wallet" ADD COLUMN "email" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "referredById" TEXT;

CREATE UNIQUE INDEX "Wallet_email_key" ON "Wallet"("email");
CREATE UNIQUE INDEX "Wallet_googleSub_key" ON "Wallet"("googleSub");
CREATE UNIQUE INDEX "Wallet_referralCode_key" ON "Wallet"("referralCode");

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SyncedChat" (
    "accountId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncedChat_pkey" PRIMARY KEY ("accountId","id")
);

ALTER TABLE "SyncedChat" ADD CONSTRAINT "SyncedChat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReferralReward" (
    "refereeId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("refereeId")
);

CREATE INDEX "ReferralReward_referrerId_idx" ON "ReferralReward"("referrerId");
