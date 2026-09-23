import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Clock } from "./lib/time";

// Sliding-window limiter: a sorted set of hit timestamps per subject.
// Returns {allowed, remaining, retryAfterMs, member}.
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then retry = tonumber(oldest[2]) + window - now end
  return {0, 0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, limit - count - 1, 0}
`;

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  /** Pass to `release` to give the slot back (for example when the request is refused later). */
  release: () => Promise<void>;
}

export class SlidingWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: Clock,
  ) {}

  async hit(subject: string): Promise<LimitResult> {
    const key = `${this.prefix}:${subject}`;
    const member = `${this.now().getTime()}-${randomUUID()}`;
    const [allowed, remaining, retry] = (await this.redis.eval(
      SCRIPT,
      1,
      key,
      String(this.now().getTime()),
      String(this.windowMs),
      String(this.limit),
      member,
    )) as [number, number, number];
    return {
      allowed: allowed === 1,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil(retry / 1000)),
      release: async () => {
        if (allowed === 1) await this.redis.zrem(key, member);
      },
    };
  }

  async remaining(subject: string): Promise<number> {
    const key = `${this.prefix}:${subject}`;
    await this.redis.zremrangebyscore(key, "-inf", this.now().getTime() - this.windowMs);
    return Math.max(0, this.limit - (await this.redis.zcard(key)));
  }
}
