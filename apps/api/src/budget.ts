import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { utcDay, utcDayStart, type Clock } from "./lib/time";

const TTL_SECONDS = 48 * 3600;

export interface Reservation {
  key: string;
  amountMicro: number;
}

/**
 * Why a free-tier reservation was refused. `exhausted`: the day's settled spend leaves no room
 * for this request. `busy`: there is room, but in-flight requests hold it until they finish.
 */
export interface Refusal {
  refused: "exhausted" | "busy";
}

export const isRefusal = (r: Reservation | Refusal): r is Refusal => "refused" in r;

/**
 * Atomic reserve. KEYS: spend, held. ARGV: amount, cap, enforce (1/0), ttl.
 * Returns {1} when reserved, or {0, settled} when refused (settled = spend not held in flight).
 */
const RESERVE = `
local amount = tonumber(ARGV[1])
local spend = tonumber(redis.call('GET', KEYS[1]) or '0')
if ARGV[3] == '1' and spend + amount > tonumber(ARGV[2]) then
  local held = tonumber(redis.call('GET', KEYS[2]) or '0')
  return {0, spend - held}
end
redis.call('INCRBY', KEYS[1], amount)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCRBY', KEYS[2], amount)
redis.call('EXPIRE', KEYS[2], ARGV[4])
return {1}
`;

/**
 * Global daily spend cap (DAILY_BUDGET_USD). Spend is tracked in micro-USD in Redis under
 * spend:{YYYY-MM-DD}. Every upstream call first reserves its worst-case cost; free-tier calls
 * are refused when the reservation would cross the cap. After the call the reservation is
 * settled to the real cost, so concurrent requests can never push spend past the cap.
 * The part of spend still reserved by in-flight calls is also kept in held:{YYYY-MM-DD}, so a
 * refusal can tell a spent budget from a momentary burst. If Redis loses the spend counter, it
 * is rebuilt from the usage log.
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

  private heldKey(spendKey: string): string {
    return spendKey.replace(/^spend:/, "held:");
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

  /** Spend today, including amounts reserved by requests still in flight. */
  async spentMicro(): Promise<number> {
    const key = this.key();
    await this.ensure(key);
    return Number((await this.redis.get(key)) ?? 0);
  }

  /** True once finished requests alone have used the whole budget. */
  async isExhausted(): Promise<boolean> {
    const key = this.key();
    await this.ensure(key);
    const [spend, held] = await this.redis.mget(key, this.heldKey(key));
    return Number(spend ?? 0) - Number(held ?? 0) >= this.capMicro;
  }

  /**
   * Reserve `amountMicro`. With `enforce` (free tiers) the reservation is refused when it would
   * take spend past the cap. Paid tiers are always allowed but still counted.
   */
  async reserve(amountMicro: number, enforce: boolean): Promise<Reservation | Refusal> {
    const key = this.key();
    await this.ensure(key);
    const amount = Math.max(0, Math.ceil(amountMicro));
    const r = (await this.redis.eval(
      RESERVE,
      2,
      key,
      this.heldKey(key),
      amount,
      this.capMicro,
      enforce ? 1 : 0,
      TTL_SECONDS,
    )) as number[];
    if (r[0] === 1) return { key, amountMicro: amount };
    return { refused: Number(r[1]) + amount > this.capMicro ? "exhausted" : "busy" };
  }

  /** Replace the reserved amount with the real cost. */
  async settle(res: Reservation, actualMicro: number): Promise<void> {
    const delta = Math.round(actualMicro) - res.amountMicro;
    const tx = this.redis.multi();
    if (delta !== 0) tx.incrby(res.key, delta);
    tx.decrby(this.heldKey(res.key), res.amountMicro);
    await tx.exec();
  }
}
