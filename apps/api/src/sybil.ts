import type { Redis } from "ioredis";
import { getAddress } from "viem";
import type { ChainReader } from "./chain/types";
import type { Clock } from "./lib/time";

export interface Eligibility {
  eligible: boolean;
  /** Why the wallet is (not) eligible, for display. */
  reason: string;
  /** Machine-readable reason when not eligible, so the website can show it in any language. */
  code?: "requirement" | "check_failed";
  /** The requirement behind code "requirement". */
  requirement?: { minEth: number; minAgeDays: number };
}

const OK_TTL = 24 * 3600;
const NO_TTL = 10 * 60;

/**
 * Sybil control for the free Explorer tier: the wallet must hold at least SYBIL_MIN_ETH_WEI of
 * the native coin, or have its first transaction more than SYBIL_MIN_WALLET_AGE_DAYS ago.
 */
export class SybilCheck {
  constructor(
    private readonly redis: Redis,
    private readonly chain: ChainReader | null,
    private readonly opts: { enabled: boolean; minWei: bigint; minAgeDays: number },
    private readonly now: Clock,
  ) {}

  get enabled(): boolean {
    return this.opts.enabled && this.chain !== null;
  }

  requirement(): string {
    const eth = Number(this.opts.minWei) / 1e18;
    return `hold at least ${eth} ETH or be more than ${this.opts.minAgeDays} days old`;
  }

  /**
   * Positive results are cached for a day. With `fresh`, a cached negative result is re-checked
   * (used when the user actually asks for a key, e.g. right after funding the wallet).
   */
  async check(address: string, opts: { fresh?: boolean } = {}): Promise<Eligibility> {
    if (!this.enabled || !this.chain) return { eligible: true, reason: "not checked" };
    const key = `sybil:${address.toLowerCase()}`;
    const cached = await this.redis.get(key);
    if (cached) {
      const c = JSON.parse(cached) as Eligibility;
      if (c.eligible || !opts.fresh) return c;
    }

    const addr = getAddress(address);
    let result: Eligibility;
    try {
      const balance = await this.chain.nativeBalance(addr);
      if (balance >= this.opts.minWei) {
        result = { eligible: true, reason: "balance" };
      } else {
        const first = await this.chain.firstTxTimestamp(addr).catch(() => null);
        const ageDays = first ? (this.now().getTime() / 1000 - first) / 86400 : 0;
        result =
          ageDays >= this.opts.minAgeDays
            ? { eligible: true, reason: "age" }
            : {
                eligible: false,
                reason: `To get a free Explorer key, your wallet needs to ${this.requirement()}.`,
                code: "requirement",
                requirement: { minEth: Number(this.opts.minWei) / 1e18, minAgeDays: this.opts.minAgeDays },
              };
      }
    } catch {
      // Chain unreachable: don't cache, ask the user to retry.
      return {
        eligible: false,
        reason: "We couldn't check your wallet right now. Try again in a minute.",
        code: "check_failed",
      };
    }
    await this.redis.set(key, JSON.stringify(result), "EX", result.eligible ? OK_TTL : NO_TTL);
    return result;
  }
}
