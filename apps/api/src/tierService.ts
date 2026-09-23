import type { PrismaClient, Tier, Wallet } from "@prisma/client";
import type { Redis } from "ioredis";
import { getAddress, type Address } from "viem";
import type { ChainReader } from "./chain/types";

export type TierSource = "override" | "credits" | "token" | "default";

export interface TierInfo {
  tier: Tier;
  source: TierSource;
}

export interface TierOptions {
  /** RFX token contract; without it (or without a chain) nobody is Holder by balance. */
  rfxToken?: Address;
  /** Whole tokens needed for Holder. */
  holderMin: number;
}

const BALANCE_TTL = 5 * 60; // HANDOFF: cache the on-chain balance for 5 minutes
const LAST_KNOWN_TTL = 7 * 24 * 3600;

/**
 * Decides a wallet's tier, in order: admin override, prepaid credits (Builder, Phase 5),
 * token holdings (Holder), then Explorer.
 */
export class TierService {
  constructor(
    protected readonly prisma: PrismaClient,
    protected readonly redis: Redis,
    protected readonly chain: ChainReader | null = null,
    protected readonly opts: TierOptions = { holderMin: 100_000 },
  ) {}

  get tokenEnabled(): boolean {
    return Boolean(this.opts.rfxToken && this.chain);
  }

  get holderMin(): number {
    return this.opts.holderMin;
  }

  /** Whole-token RFX balance (5-minute cache), or null when the token isn't configured. */
  async tokenBalance(address: string): Promise<{ units: bigint; decimals: number } | null> {
    if (!this.opts.rfxToken || !this.chain) return null;
    const key = `rfx:${address.toLowerCase()}`;
    const cached = await this.redis.get(key);
    if (cached) {
      const [u, d] = cached.split(":");
      return { units: BigInt(u!), decimals: Number(d) };
    }
    try {
      const [units, decimals] = await Promise.all([
        this.chain.tokenBalance(this.opts.rfxToken, getAddress(address)),
        this.chain.tokenDecimals(this.opts.rfxToken),
      ]);
      const value = `${units}:${decimals}`;
      await this.redis.multi().set(key, value, "EX", BALANCE_TTL).set(`${key}:last`, value, "EX", LAST_KNOWN_TTL).exec();
      return { units, decimals };
    } catch {
      // Chain briefly unreachable: fall back to the last balance we saw rather than demoting the wallet.
      const last = await this.redis.get(`${key}:last`);
      if (!last) return { units: 0n, decimals: 18 };
      const [u, d] = last.split(":");
      return { units: BigInt(u!), decimals: Number(d) };
    }
  }

  async isHolder(address: string): Promise<boolean> {
    const bal = await this.tokenBalance(address);
    if (!bal) return false;
    return bal.units >= BigInt(Math.round(this.opts.holderMin)) * 10n ** BigInt(bal.decimals);
  }

  async resolve(wallet: Pick<Wallet, "id" | "address" | "tierOverride">): Promise<TierInfo> {
    if (wallet.tierOverride) return { tier: wallet.tierOverride, source: "override" };
    if (await this.isHolder(wallet.address)) return { tier: "holder", source: "token" };
    return { tier: "explorer", source: "default" };
  }
}

/** Whole tokens as a number, for display. */
export const tokenAmount = (units: bigint, decimals: number): number =>
  Number(units / 10n ** BigInt(Math.max(0, decimals - 6))) / 10 ** Math.min(6, decimals);
