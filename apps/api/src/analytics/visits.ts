import type { Redis } from "ioredis";
import { z } from "zod";

/**
 * Cookieless visit counts, kept in Redis per UTC day for 90 days: page views, unique visitors
 * (a HyperLogLog of a hash of IP + browser that changes every day, so nobody can be followed
 * from one day to the next), the pages visited and the sites that sent people here (domain only).
 * No IP address, cookie or third-party script is involved.
 */

const TTL_SECONDS = 90 * 86_400;
const MAX_PAGES = 500;

const key = {
  views: (day: string) => `pv:views:${day}`,
  visitors: (day: string) => `pv:uv:${day}`,
  pages: (day: string) => `pv:pages:${day}`,
  refs: (day: string) => `pv:refs:${day}`,
};

export const pageViewSchema = z
  .object({
    path: z.string().max(300),
    ref: z.string().max(1000).optional(),
  })
  .strict();

const BOT_UA = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|curl|wget|python|monitor|uptime/i;
export const isBot = (ua: string | undefined) => !ua || BOT_UA.test(ua);

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** "/models/gpt?x=1#y" → "/models/gpt"; anything odd → "/other". */
export function cleanPath(path: string): string {
  const p = path.split(/[?#]/)[0]!.toLowerCase().replace(/\/+$/, "") || "/";
  return /^\/[a-z0-9/_-]{0,80}$/.test(p) ? p : "/other";
}

/** The referring site's domain, or null for none, our own site or anything unparsable. */
export function refDomain(ref: string | undefined, ownDomain: string): string | null {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === ownDomain || host.endsWith(`.${ownDomain}`)) return null;
    return /^[a-z0-9.-]{1,100}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export async function recordVisit(
  redis: Redis,
  input: { day: string; visitor: string; path: string; ref: string | null },
): Promise<void> {
  const tx = redis
    .multi()
    .incr(key.views(input.day))
    .pfadd(key.visitors(input.day), input.visitor)
    .zincrby(key.pages(input.day), 1, input.path);
  if (input.ref) tx.zincrby(key.refs(input.day), 1, input.ref);
  for (const k of Object.values(key)) tx.expire(k(input.day), TTL_SECONDS);
  // Keep the page list bounded if someone sends many made-up paths.
  tx.zremrangebyrank(key.pages(input.day), 0, -(MAX_PAGES + 1));
  await tx.exec();
}

export interface VisitSummary {
  views: number;
  visitors: number;
  pages: [string, number][];
  refs: [string, number][];
}

/** Totals over the given days (visitors are unique across them). */
export async function summarize(redis: Redis, days: string[], top = 5): Promise<VisitSummary> {
  const views = (await redis.mget(days.map(key.views))).reduce((n, v) => n + Number(v ?? 0), 0);
  const visitors = await redis.pfcount(...days.map(key.visitors));
  const add = async (keys: string[]) => {
    const totals = new Map<string, number>();
    for (const k of keys) {
      const flat = await redis.zrange(k, 0, -1, "WITHSCORES");
      for (let i = 0; i < flat.length; i += 2) {
        totals.set(flat[i]!, (totals.get(flat[i]!) ?? 0) + Number(flat[i + 1]));
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  };
  return { views, visitors, pages: await add(days.map(key.pages)), refs: await add(days.map(key.refs)) };
}

/** The last `n` UTC days ending with `now`, newest first. */
export function lastDays(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => utcDay(new Date(now.getTime() - i * 86_400_000)));
}
