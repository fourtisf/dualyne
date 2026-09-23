import type { Redis } from "ioredis";
import { utcDay, type Clock } from "./lib/time";

const TTL_SECONDS = 48 * 3600;

export interface QuotaResult {
  ok: boolean;
  /** Requests left today after this one; null when the tier has no daily cap. */
  remaining: number | null;
  /** The Redis key that was counted, so the request can be refunded. */
  key: string;
}

/** Per-wallet daily request counter: quota:{wallet}:{YYYY-MM-DD}, expires after 48h. */
export class Quota {
  constructor(
    private readonly redis: Redis,
    private readonly now: Clock,
  ) {}

  key(wallet: string, day = utcDay(this.now())): string {
    return `quota:${wallet.toLowerCase()}:${day}`;
  }

  async consume(wallet: string, limit: number | null): Promise<QuotaResult> {
    const key = this.key(wallet);
    const res = await this.redis.multi().incr(key).expire(key, TTL_SECONDS).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    if (limit !== null && count > limit) {
      await this.redis.decr(key);
      return { ok: false, remaining: 0, key };
    }
    return { ok: true, remaining: limit === null ? null : limit - count, key };
  }

  async refund(key: string): Promise<void> {
    // Never let a refund push the counter below zero.
    await this.redis.eval(
      "local v = tonumber(redis.call('GET', KEYS[1]) or '0'); if v > 0 then return redis.call('DECR', KEYS[1]) end; return 0",
      1,
      key,
    );
  }

  async used(wallet: string): Promise<number> {
    return Number((await this.redis.get(this.key(wallet))) ?? 0);
  }
}
