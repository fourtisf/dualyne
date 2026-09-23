import type { PrismaClient, Tier, Wallet } from "@prisma/client";
import type { Redis } from "ioredis";

export type TierSource = "override" | "credits" | "token" | "default";

export interface TierInfo {
  tier: Tier;
  source: TierSource;
}

/**
 * Decides a wallet's tier. Order: admin override, then (added in later phases) prepaid credits
 * and token holdings, then Explorer.
 */
export class TierService {
  constructor(
    protected readonly prisma: PrismaClient,
    protected readonly redis: Redis,
  ) {}

  async resolve(wallet: Pick<Wallet, "id" | "address" | "tierOverride">): Promise<TierInfo> {
    if (wallet.tierOverride) return { tier: wallet.tierOverride, source: "override" };
    return { tier: "explorer", source: "default" };
  }
}
