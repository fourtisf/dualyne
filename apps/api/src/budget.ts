import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { utcDay, utcDayStart, type Clock } from "./lib/time";

const TTL_SECONDS = 48 * 3600;

export interface Reservation {
  key: string;
  amountMicro: number;
}

/**
 * Global daily spend cap (DAILY_BUDGET_USD). Spend is tracked in micro-USD in Redis under
 * spend:{YYYY-MM-DD}. Every upstream call first reserves its worst-case cost; free-tier calls
 * are refused when the reservation would cross the cap. After the call the reservation is
 * settled to the real cost, so concurrent requests can never push spend past the cap.
 * If Redis loses the counter, it is rebuilt from the usage log.
 */
export class Budget {
  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient,
    private readonly capMicro: number,
    private readonly now: Clock,
  ) {}

  key(day = utcDay(this.now())): string {
    return `spend:${day}`;
  }

  private async ensure(key: string): Promise<void> {
    if (await this.redis.exists(key)) return;
    const start = utcDayStart(this.now());
    const agg = await this.prisma.usageLog.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: start } },
    });
    const spent = Number(agg._sum.costMicroUsd ?? 0n);
    await this.redis.set(key, String(spent), "EX", TTL_SECONDS, "NX");
  }

  async spentMicro(): Promise<number> {
    const key = this.key();
    await this.ensure(key);
    return Number((await this.redis.get(key)) ?? 0);
  }

  async isExhausted(): Promise<boolean> {
    return (await this.spentMicro()) >= this.capMicro;
  }

  /**
   * Reserve `amountMicro`. With `enforce` (free tiers) the reservation fails when it would take
   * spend past the cap. Paid tiers are always allowed but still counted.
   */
  async reserve(amountMicro: number, enforce: boolean): Promise<Reservation | null> {
    const key = this.key();
    await this.ensure(key);
    const amount = Math.max(0, Math.ceil(amountMicro));
    const total = await this.redis.incrby(key, amount);
    await this.redis.expire(key, TTL_SECONDS);
    if (enforce && total > this.capMicro) {
      await this.redis.decrby(key, amount);
      return null;
    }
    return { key, amountMicro: amount };
  }

  /** Replace the reserved amount with the real cost. */
  async settle(res: Reservation, actualMicro: number): Promise<void> {
    const delta = Math.round(actualMicro) - res.amountMicro;
    if (delta !== 0) await this.redis.incrby(res.key, delta);
  }
}
